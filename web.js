var async = require('async');
var dnode = require('dnode');
var ecstatic = require('ecstatic')(__dirname + '/static');
var http = require('http');
var moment = require('moment');
var request = require('request');
var shoe = require('shoe');
var swig = require('swig');
var twitter = require('ntwitter');
var url = require('url');
var util = require('util');

var _ = require('underscore');
var $ = require('jquery');

var facebook = require('./facebook');
var settings = require('./settings');

var firstPostTimestamp = null;

if (!settings.REMOTE) {
    // If we are not running with remote access to data
    var models = require('./models');

    models.once('ready', function () {
        models.Post.findOne({'merged_to': null}).sort({'foreign_timestamp': 1}).exec(function (err, post) {
            if (err) {
                console.error("Could not find the first post: %s", err);
                return;
            }

            if (post) {
                firstPostTimestamp = post.foreign_timestamp;
            }
        });
    });
}
else {
    console.warn("Not connecting to the database, using remote data: %s", settings.REMOTE);
}

swig.init({
    'root': __dirname + '/templates',
    'filters': './filters'
});

var indexTemplate = swig.compileFile('index.html');
var facebookTemplate = swig.compileFile('facebook.html');

var FACEBOOK_POST_ID_REGEXP = /(\d+)$/;

var server = http.createServer(function (req, res) {
    var req_url = url.parse(req.url, true);
    switch (req_url.pathname) {
        case '/':
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
            res.write(indexTemplate.render({
                'REMOTE': settings.REMOTE
            }));
            res.end();
            break;
        case '/facebook.html':
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
            res.write(facebookTemplate.render({
                'FACEBOOK_APP_ID': settings.FACEBOOK_APP_ID,
                'SITE_URL': settings.SITE_URL
            }));
            res.end();
            break;
        case settings.FACEBOOK_REALTIME_PATHNAME:
            if (req.method.toLowerCase() === 'post') {
                var data = '';
                req.setEncoding('utf8');
                req.addListener('data', function (chunk) {
                    data += chunk;
                }).addListener('end', function () {
                    res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
                    res.end();

                    console.log("Facebook realtime payload");
                    // TODO: We currently ignore to who payload is and just try to fetch latest, this should be improved
                    // TODO: We should fetch into the past until we get to posts we already have
                    fetchFacebookPageLatest(100);
                });
            }
            else {
                // TODO: Check X-Hub-Signature

                console.log("Facebook realtime subscription");

                if ((req_url.query['hub.mode'] !== 'subscribe') || (req_url.query['hub.verify_token'] !== settings.FACEBOOK_REALTIME_VERIFY_TOKEN)) {
                    res.writeHead(400);
                    res.end();
                    return;
                }

                res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
                res.write(req_url.query['hub.challenge']);
                res.end();
            }
            break;
        default:
            ecstatic(req, res);
            break;
    }
});

server.on('error', function (e) {
    console.error("Cannot start the server: %s", e);
    process.exit(1);
});

server.listen(settings.PORT);

// TODO: This should be distributed if we will have multiple instances
var clients = [];

var sock = shoe(function (stream) {
    var d = dnode({
        'getPosts': function (since, except, limit, cb) {
            if (!cb) {
                return;
            }

            limit = parseInt(limit) || settings.MAX_POSTS_PER_REQUEST;
            if ((limit <= 0) || (limit > settings.MAX_POSTS_PER_REQUEST)) {
                limit = settings.MAX_POSTS_PER_REQUEST;
            }

            var query = {'$where': models.Post.NOT_FILTERED, 'merged_to': null, 'original_data.retweeted_status': null};
            if (since) {
                since = moment(since);
                if (since.isValid()) {
                    query.foreign_timestamp = {'$lte': since.toDate()};
                }
            }
            if (_.isArray(except)) {
                query.type_foreign_id = {'$nin': except};
            }

            models.Post.find(_.extend({}, query, settings.POSTS_FILTER), models.Post.PUBLIC_FIELDS).sort({'foreign_timestamp': 'desc'}).limit(limit).lean(true).exec(function (err, posts) {
                if (err) {
                    // TODO: Do we really want to pass an error about accessing the database to the client?
                    cb(err);
                    return;
                }

                async.map(posts, function (post, cb) {
                    post = models.Post.cleanPost(post);

                    if (post.facebook_event_id) {
                        models.FacebookEvent.findOne({'event_id': post.facebook_event_id}, {'event_id': true, 'data': true, 'invited_summary': true}).lean(true).exec(function (err, event) {
                            if (err) {
                                // TODO: Do we really want to pass an error about accessing the database to the client?
                                cb(err);
                                return;
                            }

                            if (!event) {
                                // TODO: Do we really want to pass an error about accessing the database to the client?
                                cb("Facebook event (" + post.facebook_event_id + ") for post (" + post.foreign_id + ") not found");
                                return;
                            }

                            event.fetch_timestamp = event._id.getTimestamp();
                            delete event._id;

                            post.facebook_event = event;
                            delete post.facebook_event_id;

                            cb(null, post);
                        });
                    }
                    else {
                        delete post.facebook_event_id;
                        cb(null, post);
                    }
                }, function (err, posts) {
                    // TODO: Do we really want to pass an error about accessing the database to the client?
                    cb(err, posts);
                });
            });
        },
        'getStats': function (from, to, cb) {
            if (!cb) {
                return;
            }

            var query = {'merged_to': null};

            if (from) {
                from = moment(from);
                if (!from.isValid()) {
                    cb("Invalid from timestamp");
                    return;
                }

                if (!query.foreign_timestamp) {
                    query.foreign_timestamp = {};
                }
                query.foreign_timestamp['$gte'] = from;
            }
            else {
                // Approximate (for timespans to be correct), but we do not want to use it for query
                from = firstPostTimestamp;
            }
            if (to) {
                to = moment(to);
                if (!to.isValid()) {
                    cb("Invalid to timestamp");
                    return;
                }

                if (!query.foreign_timestamp) {
                    query.foreign_timestamp = {};
                }
                query.foreign_timestamp['$lte'] = to;
            }
            else {
                // Approximate (for timespans to be correct), but we do not want to use it for query
                to = moment();
            }

            var enlarge = {'weeks': 2};
            var timespans = ['year', 'week'];
            if (from && to) {
                if (to - from < 365 * 24 * 60 * 60 * 1000) { // 1 year
                    // Max 365 values
                    timespans.push('dayOfYear');
                    enlarge = {'days': 2};
                }
                if (to - from < 2 * 7 * 24 * 60 * 60 * 1000) { // 2 weeks
                    // Max 2 * 7 * 24 = 336 values
                    timespans.push('hour');
                    enlarge = {'hours': 2};
                }
                if (to - from <= 6 * 60 * 60 * 1000) { // 6 hours
                    // Max 6 * 60 = 360 values
                    timespans.push('minute');
                    enlarge = {'minutes': 2};
                }
            }

            // Enlarge interval a bit and convert limits to Date objects
            if (query.foreign_timestamp && query.foreign_timestamp['$gte']) {
                query.foreign_timestamp['$gte'] = query.foreign_timestamp['$gte'].subtract(enlarge).toDate();
            }
            if (query.foreign_timestamp && query.foreign_timestamp['$lte']) {
                query.foreign_timestamp['$lte'] = query.foreign_timestamp['$lte'].add(enlarge).toDate();
            }

            var id = {};
            var project = {'$project': {
                'is_twitter': {'$cond': [{'$eq': ['$type', 'twitter']}, 1, 0]},
                'is_facebook': {'$cond': [{'$eq': ['$type', 'facebook']}, 1, 0]}
            }};
            _.each(timespans, function (timespan, i, list) {
                project['$project'][timespan] = {};
                project['$project'][timespan]['$' + timespan] = '$foreign_timestamp';
                id[timespan] = '$' + timespan;
            });

            models.Post.aggregate([
                {'$match': query},
                project,
                {'$group': {
                    '_id': id,
                    'count_all': {'$sum': 1},
                    'count_twitter': {'$sum': '$is_twitter'},
                    'count_facebook': {'$sum': '$is_facebook'}
                }},
                {'$sort': {'_id': 1}}
            ], function (err, results) {
                if (err) {
                    // TODO: Do we really want to pass an error about accessing the database to the client?
                    cb(err);
                    return;
                }

                var stats = [];
                _.each(results, function (result, i, list) {
                    if (timespans.length > 2) {
                        var timestamp = moment.utc(result._id.year + '-' + (result._id.dayOfYear || '0') + '-' + (result._id.hour || '0') + '-' + (result._id.minute || '0'), 'YYYY-DDD-HH-mm')
                    }
                    else {
                        if (result._id.week === 0) {
                            if (stats.length > 0) {
                                stats[stats.length - 1][1] += result.count_all;
                                stats[stats.length - 1][2] += result.count_twitter;
                                stats[stats.length - 1][3] += result.count_facebook;
                            }
                            return;
                        }
                        else {
                            var timestamp = moment.utc().startOf('year').year(result._id.year);
                            while (timestamp.day() !== 0) {
                                timestamp.add('days', 1);
                            }
                            timestamp.add('weeks', result._id.week - 1);
                        }
                    }
                    stats.push([timestamp.valueOf(), result.count_all, result.count_twitter, result.count_facebook]);
                });

                cb(null, stats);
            });
        }
    });
    d.on('remote', function (remote, d) {
        clients.push(remote);
    }).on('end', function () {
        // TODO: We should clean connections, too
        // https://github.com/substack/dnode/pull/111
    }).pipe(stream).pipe(d);
});

sock.install(server, '/dnode');

var twit = null;
if (models && settings.TWITTER_ACCESS_TOKEN_KEY && settings.TWITTER_ACCESS_TOKEN_SECRET) {
    twit = new twitter({
        'consumer_key': settings.TWITTER_CONSUMER_KEY,
        'consumer_secret': settings.TWITTER_CONSUMER_SECRET,
        'access_token_key': settings.TWITTER_ACCESS_TOKEN_KEY,
        'access_token_secret': settings.TWITTER_ACCESS_TOKEN_SECRET
    });
}

function notifyClients(err, post, event) {
    if (err) {
        console.error(err);
        return;
    }

    if (post) {
        async.forEach(clients, function (client, cb) {
            client.newPost(post);
            cb(null);
        });
    }
    if (event) {
        async.forEach(clients, function (client, cb) {
            client.newEvent(event);
            cb(null);
        });
    }
}

function connectToTwitterStream() {
    console.log("Twitter stream connecting");
    twit.stream('statuses/filter', {'track': settings.TWITTER_QUERY}, function (stream) {
        console.log("Twitter stream connected");
        stream.on('data', function (data) {
            if (data['disconnect']) {
                console.warn("Twitter stream disconnected", data['disconnect']);
                // TODO: Back-off
                connectToTwitterStream();
            }
            else if (data.from_user || data.user) {
                models.Post.storeTweet(data, 'stream', notifyClients);
            }
            else {
                console.error("Invalid Tweet", data);
                throw new Error("Invalid Tweet");
            }
        }).on('delete', function (data) {
            // TODO: Implement (https://dev.twitter.com/docs/streaming-apis/messages)
            console.log("Twitter delete", data);
        }).on('scrub_geo', function (data) {
            // TODO: Implement (https://dev.twitter.com/docs/streaming-apis/messages)
            console.log("Twitter scrub_geo", data);
        }).on('end', function (res) {
            console.warn("Twitter stream disconnected", res);
            // TODO: Back-off
            connectToTwitterStream();
        }).on('destroy', function (res) {
            console.warn("Twitter stream disconnected", res);
            // TODO: Back-off
            connectToTwitterStream();
        });
    });
}

function fetchTwitterLatest() {
    console.log("Doing Twitter fetch");

    // TODO: Should we simply automatically start loading all tweets until we find one existing in the database?
    var params = {'include_entities': true, 'count': 100, 'q': settings.TWITTER_QUERY.join(' OR ')};
    twit.get('/search/tweets.json', params, function(err, data) {
        if (err) {
            console.error("Twitter fetch error", err);
            return;
        }

        async.forEach(data.statuses, function (tweet, cb) {
            models.Post.storeTweet(tweet, 'search', function (err, tweet) {
                notifyClients(err, tweet);
                // We handle error independently
                cb(null);
            });
        }, function (err) {
            console.log("Twitter fetch done");
        });
    });
}

if (twit) {
    fetchTwitterLatest();
    connectToTwitterStream();
}
else {
    console.warn("Not fetching content from Twitter.");
}

function fetchFacebookLatest(limit) {
    async.forEach(settings.FACEBOOK_QUERY, function (keyword, cb) {
        console.log("Doing Facebook search: %s", keyword);

        // Facebook search API does not allow multiple response pages so limit should not be larger than allowed limit for one response page (5000)
        facebook.request('search?type=post&q=' + encodeURIComponent(keyword), limit || 5000, function (err, body) {
            if (err) {
                console.error("Facebook search error (%s): %s", keyword, err);
                // We handle error independently
                cb(null);
                return;
            }

            async.forEach(body.data, function (post, cb) {
                models.Post.storeFacebookPost(post, 'search', function (err, post, event) {
                    notifyClients(err, post, event);
                    // We handle error independently
                    cb(null);
                });
            }, function (err) {
                console.log("Facebook search done: %s", keyword);
                cb(null);
            });
        });
    });
}

function fetchFacebookPageLatest(limit) {
    console.log("Doing Facebook page fetch");

    facebook.request(settings.FACEBOOK_PAGE_ID + '/tagged', limit, function (err, body) {
        if (err) {
            console.error("Facebook page fetch error: %s", err);
            return;
        }

        async.forEach(body.data, function (post, cb) {
            models.Post.storeFacebookPost(post, 'tagged', function (err, post, event) {
                notifyClients(err, post, event);
                // We handle error independently
                cb(null);
            });
        }, function (err) {
            console.log("Facebook page fetch done");
        });
    });
}

function fetchFacebookPageLatestAlternative() {
    console.log("Doing Facebook page alternative fetch");

    request({
        'url': 'https://www.facebook.com/' + settings.FACEBOOK_PAGE_ID + '?filter=2',
        'headers': {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.7; rv:18.0) Gecko/20100101 Firefox/18.0'
        }
    }, function (error, res, body) {
        if (error || !res || res.statusCode !== 200) {
            console.error("Facebook page alternative fetch error", error, res && res.statusCode, body);
            return;
        }

        var post_ids = [];
        var post_ids2 = [];

        $('*', body).contents().filter(function (i) {
            // Only comments
            return this.nodeType === 8;
        }).each(function (i, comment) {
            // Facebook stores displayed content in comments, so we parse comments again and find links to posts
            $('[role="article"]', comment.nodeValue).find('a.uiLinkSubtle:first').each(function (j, link) {
                var post_match = FACEBOOK_POST_ID_REGEXP.exec($(link).attr('href'));
                if (post_match) {
                    post_ids.push(post_match[1]);
                }
                else {
                    console.warn("Facebook page alternative fetch found link, but doesn't match: %s", $(link).attr('href'));
                }
            });
            $('[name="feedback_params"]', comment.nodeValue).each(function (j, input) {
                try {
                    var params = JSON.parse($(input).attr('value'));
                }
                catch (e) {
                    return;
                }
                post_ids2.push(params.target_profile_id + '_' + params.target_fbid);
            })
        });

        async.forEachSeries(post_ids, function (post_id, cb) {
            facebook.request(post_id, null, function (err, body) {
                if (err) {
                    // Silenced, because we are guessing IDs here and some are not correct
                    //console.error("Facebook page alternative fetch error (%s): %s", post_id, err);
                    // We handle error independently
                    cb(null);
                }
                else {
                    // Try to get post version with more information
                    facebook.request(body.from.id + '_' + post_id, null, function (err, better_body) {
                        if (err) {
                            // We will have to use more limited version, it seems
                            better_body = body;
                        }

                        models.Post.storeFacebookPost(better_body, 'taggedalt', function (err, post, event) {
                            notifyClients(err, post, event);
                            // We handle error independently
                            cb(null);
                        });
                    });
                }
            });
        }, function (err) {
            async.forEachSeries(post_ids2, function (post_id, cb) {
                facebook.request(post_id, null, function (err, body) {
                    if (err) {
                        // Silenced, because we are guessing IDs here and some are not correct
                        //console.error("Facebook page alternative fetch error (%s): %s", post_id, err);
                        // We handle error independently
                        cb(null);
                    }
                    else {
                        models.Post.storeFacebookPost(body, 'taggedalt', function (err, post, event) {
                            notifyClients(err, post, event);
                            // We handle error independently
                            cb(null);
                        });
                    }
                });
            }, function (err) {
                console.log("Facebook page alternative fetch done");
            });
        });
    });
}

function fetchFacebookRecursiveEventsLatest(limit, cb) {
    models.FacebookEvent.find({'recursive': true}, function (err, events) {
        if (err) {
            console.error("Facebook recursive events fetch error: %s", err);
            return;
        }

        async.forEach(events, function (event, cb) {
            console.log("Doing Facebook recursive event fetch: %s", event.event_id);

            facebook.request(event.event_id + '/feed', limit, function (err, body) {
                if (err) {
                    console.error("Facebook recursive events fetch error (%s): %s", event.event_id, err);
                    // We handle error independently
                    cb(null);
                    return;
                }

                async.forEach(body.data, function (post, cb) {
                    models.Post.storeFacebookPost(post, ['event', 'event/' + event.event_id], function (err, post, event) {
                        notifyClients(err, post, event);
                        // We handle error independently
                        cb(null);
                    });
                }, function (err) {
                    console.log("Facebook recursive event fetch done: %s", event.event_id);
                    cb(null);
                });
            });
        }, function (err) {
            if (cb) {
                cb(err);
            }
        });
    });
}

function checkFacebookPageAdded(cb) {
    facebook.request(settings.FACEBOOK_PAGE_ID + '/tabs', null, function (err, body) {
        if (err) {
            cb(err);
            return;
        }

        // TODO: Implement check and only if OK, call callback
        console.log("Facebook app %s added to the page %s", settings.FACEBOOK_APP_ID, settings.FACEBOOK_PAGE_ID);
        cb(null);
    });
}

function addAppToFacebookPage(cb) {
    facebook.request.post(settings.FACEBOOK_PAGE_ID + '/tabs?app_id=' + settings.FACEBOOK_APP_ID, function (err, body) {
        if (err) {
            cb(err);
            return;
        }

        checkFacebookPageAdded(cb);
    });
}

function subscribeToFacebook(err) {
    if (err) {
        console.error(err);
    }
    // TODO: Implement, currently set manually through Facebook web interface
    // facebook.request.post(settings.FACEBOOK_APP_ID + '/subscriptions', function (err, body) {
}

function enableFacebookStream() {
    addAppToFacebookPage(subscribeToFacebook);
}

function pollFacebookRecursiveEventsLatest() {
    // The first time we read all posts
    fetchFacebookRecursiveEventsLatest(0, function (err) {
        // We enqueue next polling
        function polling() {
            fetchFacebookRecursiveEventsLatest(1000, function (err) {
                setTimeout(polling, settings.FACEBOOK_POLL_INTERVAL);
            });
        }
        setTimeout(polling, settings.FACEBOOK_POLL_INTERVAL);
    });
}

function facebookPolling() {
    fetchFacebookLatest(1000);
    fetchFacebookPageLatest(1000);
    fetchFacebookPageLatestAlternative();
}

if (models && settings.FACEBOOK_ACCESS_TOKEN) {
    // Fetch all posts
    fetchFacebookLatest(5000);
    fetchFacebookPageLatest(0);
    fetchFacebookPageLatestAlternative();

    enableFacebookStream();

    pollFacebookRecursiveEventsLatest();

    setInterval(facebookPolling, settings.FACEBOOK_POLL_INTERVAL);
}
else {
    console.warn("Not fetching content from Facebook.");
}

function keepAlive() {
    request(settings.SITE_URL, function (error, res, body) {
        if (error || !res || res.statusCode !== 200) {
            console.error("Keep alive error: %s", settings.SITE_URL, error, res && res.statusCode, body);
        }
    });
}

setInterval(keepAlive, settings.KEEP_ALIVE_INTERVAL);

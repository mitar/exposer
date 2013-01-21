var async = require('async');
var dnode = require('dnode');
var ecstatic = require('ecstatic')(__dirname + '/static');
var http = require('http');
var request = require('request');
var shoe = require('shoe');
var swig = require('swig');
var twitter = require('ntwitter');
var url = require('url');
var util = require('util');

var _ = require('underscore');

var facebook = require('./facebook');
var models = require('./models');
var settings = require('./settings');

swig.init({
    'root': __dirname + '/templates',
    'filters': './filters'
});

var indexTemplate = swig.compileFile('index.html');
var facebookTemplate = swig.compileFile('facebook.html');

var server = http.createServer(function (req, res) {
    var req_url = url.parse(req.url, true);
    switch (req_url.pathname) {
        case '/':
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
            res.write(indexTemplate.render({}));
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
server.listen(settings.PORT);

// TODO: This should be distributed if we will have multiple instances
var clients = [];

var sock = shoe(function (stream) {
    var d = dnode({
        'getPosts': function (since, except, limit, cb) {
            limit = parseInt(limit) || settings.MAX_POSTS_PER_REQUEST;
            if ((limit <= 0) || (limit > settings.MAX_POSTS_PER_REQUEST)) {
                limit = settings.MAX_POSTS_PER_REQUEST;
            }

            var query = {'$where': models.Post.NOT_FILTERED};
            if (since) {
                since = new Date(since);
                if (isFinite(since)) {
                    query.foreign_timestamp = {'$lte': since};
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

var twit = new twitter({
    'consumer_key': settings.TWITTER_CONSUMER_KEY,
    'consumer_secret': settings.TWITTER_CONSUMER_SECRET,
    'access_token_key': settings.TWITTER_ACCESS_TOKEN_KEY,
    'access_token_secret': settings.TWITTER_ACCESS_TOKEN_SECRET
});

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
                console.warn("Twitter stream disconnected: %s", data['disconnect']);
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
            console.log("Twitter delete: %s", data);
        }).on('scrub_geo', function (data) {
            // TODO: Implement (https://dev.twitter.com/docs/streaming-apis/messages)
            console.log("Twitter scrub_geo: %s", data);
        }).on('end', function (res) {
            console.warn("Twitter stream disconnected: %s", res);
            // TODO: Back-off
            connectToTwitterStream();
        }).on('destroy', function (res) {
            console.warn("Twitter stream disconnected: %s", res);
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
            console.error("Twitter fetch error: %s", err);
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

fetchTwitterLatest();
connectToTwitterStream();

function fetchFacebookLatest(limit) {
    var keywords = settings.FACEBOOK_QUERY.slice(0);

    function fetchFirst() {
        if (keywords.length == 0) {
            return;
        }

        var keyword = keywords[0];
        keywords = keywords.slice(1);

        console.log("Doing Facebook search: %s", keyword);

        // Facebook search API does not allow multiple response pages so limit should not be larger than allowed limit for one response page (5000)
        facebook.request('search?type=post&q=' + encodeURIComponent(keyword), limit || 5000, function (err, body) {
            if (err) {
                console.error(err);
                setTimeout(fetchFirst, settings.FACEBOOK_INTERVAL_WHEN_ITERATING);
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
                setTimeout(fetchFirst, settings.FACEBOOK_INTERVAL_WHEN_ITERATING);
            });
        });
    }

    fetchFirst();
}

function fetchFacebookPageLatest(limit) {
    console.log("Doing Facebook page fetch");

    facebook.request(settings.FACEBOOK_PAGE_ID + '/tagged', limit, function (err, body) {
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

function fetchFacebookRecursiveEventsLatest(limit) {
    models.FacebookEvent.find({'recursive': true}, function (err, events) {
        if (err) {
            console.error("Facebook recursive events fetch error: %s", err);
            return;
        }

        function fetchFirst() {
            if (events.length == 0) {
                return;
            }

            var event = events[0];
            events = events.slice(1);

            console.log("Doing Facebook recursive event fetch: %s", event.event_id);

            facebook.request(event.event_id + '/feed', limit, function (err, body) {
                if (err) {
                    console.error(err);
                    setTimeout(fetchFirst, settings.FACEBOOK_INTERVAL_WHEN_ITERATING);
                    return;
                }

                async.forEachSeries(body.data, function (post, cb) {
                    models.Post.storeFacebookPost(post, ['event', 'event/' + event.event_id], function (err, post, event) {
                        notifyClients(err, post, event);
                        // We handle error independently
                        cb(null);
                    });
                }, function (err) {
                    console.log("Facebook recursive event fetch done: %s", event.event_id);
                    setTimeout(fetchFirst, settings.FACEBOOK_INTERVAL_WHEN_ITERATING);
                });
            });
        }

        fetchFirst();
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

// Fetch all posts
fetchFacebookLatest(5000);
fetchFacebookPageLatest(0);
fetchFacebookRecursiveEventsLatest(0);

enableFacebookStream();

function facebookPolling() {
    fetchFacebookLatest(1000);
    fetchFacebookPageLatest(1000);
    fetchFacebookRecursiveEventsLatest(1000);
}

setInterval(facebookPolling, settings.FACEBOOK_POLL_INTERVAL);

function keepAlive() {
    request(settings.SITE_URL, function (error, res, body) {
        if (error || !res || res.statusCode !== 200) {
            console.error("Keep alive error: %s", settings.SITE_URL, error, res && res.statusCode, body);
        }
    });
}

setInterval(keepAlive, settings.KEEP_ALIVE_INTERVAL);

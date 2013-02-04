var async = require('async');
var consolidate = require('consolidate');
var dnode = require('dnode');
var express = require('express');
var http = require('http');
var i18next = require("i18next");
var i18nextWrapper = require('i18next/lib/i18nextWrapper');
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

var app = express();

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

i18next.init({
    'fallbackLng': settings.I18N_LANGUAGES[0],
    'preload': settings.I18N_LANGUAGES,
    'supportedLngs': settings.I18N_LANGUAGES,
    'saveMissing': app.get('env') !== 'production',
    // We use session for storing the language preference
    'useCookie': false,
    'detectLngFromPath': false
});

var origDetectLanguage = null;
if (origDetectLanguage === null) {
    origDetectLanguage = i18nextWrapper.detectLanguage;
    i18nextWrapper.detectLanguage = function(req, res) {
        var language = null;
        if (req.session.language && _.indexOf(settings.I18N_LANGUAGES, req.session.language) !== -1) {
            language = req.session.language;
        }
        else {
            language = origDetectLanguage(req, res);
            req.session.language = language;
        }
        return language;
    }
}

swig.init({
    'root': __dirname + '/templates',
    'filters': './filters',
    'allowErrors': true // Allows errors to be thrown and caught by express instead of suppressed by Swig
});

var FACEBOOK_POST_ID_REGEXP = /(\d+)$/;

app.engine('html', consolidate.swig);

app.enable('case sensitive routing');
app.enable('strict routing');
app.disable('x-powered-by');

if (settings.BEHIND_PROXY) {
    app.enable('trust proxy');
}

app.set('view engine', 'html');
app.set('views', __dirname + '/templates');

i18next.registerAppHelper(app);

app.use(express.cookieParser());
app.use(express.cookieSession({
    'key': 'session',
    'secret': settings.SECRET,
    'proxy': settings.BEHIND_PROXY,
    'cookie': {
        'secure': settings.SECURE_SESSION_COOKIE,
        'httpOnly': true,
        'maxAge': 2 * 365 * 24 * 60 * 60 * 1000 // 2 years
    }
}));
app.use(express.bodyParser());
app.use(express.static(__dirname + '/static'));
app.use(i18next.handle);

i18next.serveClientScript(app).serveDynamicResources(app);

if (app.get('env') !== 'production') {
    // TODO: Set sendMissing to true on the client side, if not in the production
    i18next.serveMissingKeyRoute(app).serveChangeKeyRoute(app).serveRemoveKeyRoute(app);

    i18next.serveWebTranslate(app, {
        'path': '/i18next',
        'i18nextWTOptions': {
            'languages': settings.I18N_LANGUAGES,
            'fallbackLng': settings.I18N_LANGUAGES[0],
            'namespaces': ['translation'],
            // Have to specify all paths because currently there is a bug in i18next to not merge properly options with defaults
            'resGetPath': 'locales/resources.json?lng=__lng__&ns=__ns__',
            'resChangePath': 'locales/change/__lng__/__ns__',
            'resRemovePath': 'locales/remove/__lng__/__ns__',
            'dynamicLoad': true
        }
    });
}

app.get('/', function (req, res) {
    var translations = {
        'section': {
            'stream': {
                'twitter-hashtag': settings.TWITTER_QUERY[0] ? '<tt>' + settings.TWITTER_QUERY[0] + '</tt>' : null,
                'facebook-page-name': settings.FACEBOOK_PAGE_NAME
            },
            'links': {
                'edit-link': '<a href="https://github.com/mitar/exposer/blob/master/templates/links.html">' + req.i18n.t("section.links.edit") + '</a>'
            }
        }
    };
    translations.section.stream['facebook-page-link'] = null;
    if (settings.FACEBOOK_PAGE_NAME && settings.FACEBOOK_PAGE_ID) {
        translations.section.stream['facebook-page-link'] = '<a href="https://www.facebook.com/pages/' + settings.FACEBOOK_PAGE_NAME + '/' + settings.FACEBOOK_PAGE_ID + '" title="' + req.i18n.t("section.stream.facebook-page", translations) + '"><tt>@' + settings.FACEBOOK_PAGE_NAME.toLowerCase() + '</tt></a>';
    }
    var languages = _.map(settings.I18N_LANGUAGES, function (language, i, eval) {
        return {
            'name': language,
            'native': req.i18n.t("languages." + language, {'lng': language}),
            'translated': req.i18n.t("languages." + language),
            'current': req.language == language
        };
    });
    languages.current = req.language;
    res.render('index', {
        'REMOTE': settings.REMOTE,
        'FACEBOOK_APP_ID': settings.FACEBOOK_APP_ID,
        'FACEBOOK_PAGE_ID': settings.FACEBOOK_PAGE_ID,
        'FACEBOOK_PAGE_NAME': settings.FACEBOOK_PAGE_NAME,
        'TWITTER_ENABLED': !!settings.TWITTER_QUERY[0],
        'TWITTER_MORE': settings.TWITTER_QUERY.length > 1,
        'FACEBOOK_ENABLED': !!settings.FACEBOOK_PAGE_NAME,
        'FACEBOOK_MORE': settings.FACEBOOK_QUERY.length > 0,
        'SHOW_LINKS': !!settings.SHOW_LINKS,
        'SITE_URL': settings.SITE_URL,
        'languages': languages,
        'translations': translations
    });
});

app.get('/fb', function (req, res) {
    res.render('facebook', {
        'FACEBOOK_APP_ID': settings.FACEBOOK_APP_ID,
        'SITE_URL': settings.SITE_URL
    });
});

app.post(settings.FACEBOOK_REALTIME_PATHNAME, function (req, res) {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send('');

    console.log("Facebook realtime payload", req.body);
    // TODO: We currently ignore to who payload is and just try to fetch latest, this should be improved
    // TODO: We should fetch into the past until we get to posts we already have
    fetchFacebookPageLatest(100);
    fetchFacebookPageLatestAlternative();
});

app.get(settings.FACEBOOK_REALTIME_PATHNAME, function (req, res) {
    // TODO: Check X-Hub-Signature

    console.log("Facebook realtime subscription");

    res.set('Content-Type', 'text/plain; charset=utf-8');

    if ((req.query['hub.mode'] !== 'subscribe') || (req.query['hub.verify_token'] !== settings.FACEBOOK_REALTIME_VERIFY_TOKEN)) {
        res.status(400);
        res.send('');
        return;
    }

    res.send(req.query['hub.challenge']);
});

app.post('/locales/set', function (req, res) {
    if (req.body.language && _.indexOf(settings.I18N_LANGUAGES, req.body.language) !== -1) {
        req.session.language = req.body.language;
    }
    res.redirect('back');
});

var server = http.createServer(app);
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
                    console.error("getPosts error: %s", err);
                    // TODO: Do we really want to pass an error about accessing the database to the client?
                    cb(err);
                    return;
                }

                async.map(posts, function (post, cb) {
                    post = models.Post.cleanPost(post);

                    if (post.facebook_event_id) {
                        models.FacebookEvent.findOne({'event_id': post.facebook_event_id}, models.FacebookEvent.PUBLIC_FIELDS).lean(true).exec(function (err, event) {
                            if (err) {
                                console.error("getPosts error: %s", err);
                                // TODO: Do we really want to pass an error about accessing the database to the client?
                                cb(err);
                                return;
                            }

                            if (!event) {
                                var err = "Facebook event (" + post.facebook_event_id + ") for post (" + post.foreign_id + ") not found";
                                console.error("getPosts error: %s", err);
                                // TODO: Do we really want to pass an error about accessing the database to the client?
                                cb(err);
                                return;
                            }

                            event = models.FacebookEvent.cleanEvent(event);

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
                    if (err) {
                        console.error("getPosts error: %s", err);
                    }
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
                if (to - from < 240 * 24 * 60 * 60 * 1000) { // 240 days
                    // Max 240 values
                    timespans.push('dayOfYear');
                    enlarge = {'days': 2};
                }
                if (to - from < 10 * 24 * 60 * 60 * 1000) { // 10 days
                    // Max 10 * 24 = 240 values
                    timespans.push('hour');
                    enlarge = {'hours': 2};
                }
                if (to - from <= 4 * 60 * 60 * 1000) { // 4 hours
                    // Max 4 * 60 = 240 values
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
                    console.error("getStats error: %s", err);
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
        },
        'getEvents': function (cb) {
            if (!cb) {
                return;
            }

            models.FacebookEvent.find({}, models.FacebookEvent.PUBLIC_FIELDS).lean(true).exec(function (err, events) {
                if (err) {
                    console.error("getEvents error: %s", err);
                    // TODO: Do we really want to pass an error about accessing the database to the client?
                    cb(err);
                    return;
                }

                events = _.map(events, function (event, i, list) {
                    return models.FacebookEvent.cleanEvent(event);
                });

                cb(null, events);
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
    if (!settings.FACEBOOK_PAGE_ID) {
        return;
    }

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
    if (!settings.FACEBOOK_PAGE_ID) {
        return;
    }

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
    if (!settings.FACEBOOK_PAGE_ID) {
        return;
    }

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

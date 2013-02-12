if (process.env.NODETIME_ACCOUNT_KEY) {
    require('nodetime').profile({
        'accountKey': process.env.NODETIME_ACCOUNT_KEY,
        'appName': 'Exposer'
    });
}

var async = require('async');
var consolidate = require('consolidate');
var crypto = require('crypto');
var dnode = require('dnode');
var express = require('express');
var fs = require('fs');
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
        var query = {'$where': models.Post.NOT_FILTERED, 'merged_to': null, 'data.is_retweet': {'$ne': true}};
        models.Post.findOne(_.extend({}, query, settings.POSTS_FILTER)).sort({'foreign_timestamp': 1}).exec(function (err, post) {
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
    'filters': require('./filters'),
    'allowErrors': true // Allows errors to be thrown and caught by express instead of suppressed by Swig
});

var render = require('./render')({
    'twitter': function (context) {
        return swig.compileFile('posts/twitter.html').render(context);
    },
    'facebook': function (context) {
        return swig.compileFile('posts/facebook.html').render(context);
    },
    'event': function (context) {
        return swig.compileFile('event.html').render(context);
    }
});

var FACEBOOK_POST_ID_REGEXP = /\/(\d+)$/;
var FACEBOOK_POST_PERMALINK_REGEXP = /permalink\.php\?story_fbid/;
var FACEBOOK_QUERY_REGEXP = new RegExp(settings.FACEBOOK_QUERY.join('|'), 'i');

var BUNDLE_TIMESTAMP = null;

if (app.get('env') === 'production') {
    fs.stat('./static/bundle.js', function (err, stats) {
        if (err) {
            console.error("Bundle file does not exist? Have you forgot to run browserify?", err);
            // TODO: Handle better?
            throw new Error("Bundle file does not exist? Have you forgot to run browserify?");
        }

        var shasum = crypto.createHash('sha256');
        shasum.update('' + stats.mtime.valueOf());
        BUNDLE_TIMESTAMP = shasum.digest('hex').slice(0, 10);
    });
}

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

function forceSiteUrl(site_url) {
    site_url = site_url || settings.SITE_URL;

    var site_parsed = url.parse(site_url);
    var site_request = site_parsed.protocol + '//' + site_parsed.host.toLowerCase();

    return function (req, res, next) {
        var request = req.protocol + '://' + req.get('Host').toLowerCase();
        if (request === site_request) {
            next();
            return
        }

        console.log('Request with invalid host, redirecting: %s', request);
        res.redirect(site_url + req.originalUrl);
    };
}

app.use(forceSiteUrl());
app.use(express.compress());
app.use(express.static(__dirname + '/static'));
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

    var escaped_fragment = null;
    if (_.has(req.query, '_escaped_fragment_')) {
        escaped_fragment = req.query._escaped_fragment_ || 'stream';
    }

    function response(err, escaped_fragment_content) {
        // We ignore the error and just proceed

        res.render('index', {
            'REMOTE': settings.REMOTE,
            'FACEBOOK_APP_ID': settings.FACEBOOK_APP_ID,
            'FACEBOOK_PAGE_ID': settings.FACEBOOK_PAGE_ID,
            'FACEBOOK_PAGE_NAME': settings.FACEBOOK_PAGE_NAME,
            'TWITTER_ENABLED': !!settings.TWITTER_QUERY[0],
            'TWITTER_MORE': settings.TWITTER_QUERY.length > 1,
            'FACEBOOK_ENABLED': !!settings.FACEBOOK_PAGE_NAME,
            'FACEBOOK_MORE': settings.FACEBOOK_QUERY.length > 0,
            'SHOW_EVENTS': !!settings.SHOW_EVENTS,
            'SHOW_LINKS': !!settings.SHOW_LINKS,
            'SITE_URL': settings.SITE_URL,
            'GOOGLE_SITE_VERIFICATION': settings.GOOGLE_SITE_VERIFICATION,
            'BUNDLE_TIMESTAMP': BUNDLE_TIMESTAMP,
            'escaped_fragment': escaped_fragment,
            'escaped_fragment_content': escaped_fragment_content,
            'languages': languages,
            'translations': translations
        });
    }

    if (escaped_fragment === 'stream') {
        renderPosts(response);
    }
    else if (escaped_fragment === 'events') {
        renderEvents(response);
    }
    else {
        response(null, null);
    }
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

    console.log("Facebook realtime payload", util.inspect(req.body, false, 10));
    // TODO: We currently ignore to who payload is and just try to fetch latest, this should be improved
    // TODO: We should fetch into the past until we get to posts we already have

    if (settings.FACEBOOK_PAGE_ID) {
        fetchFacebookPageLatest(100);
        fetchFacebookPageLatestAlternative();
    }
    else {
        console.warn("Igoring Facebook realtime request");
    }
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

function getPosts(since, except, limit, cb) {
    if (!cb) {
        return;
    }

    limit = parseInt(limit) || settings.MAX_POSTS_PER_REQUEST;
    if ((limit <= 0) || (limit > settings.MAX_POSTS_PER_REQUEST)) {
        limit = settings.MAX_POSTS_PER_REQUEST;
    }

    var query = {'$where': models.Post.NOT_FILTERED, 'merged_to': null, 'data.is_retweet': {'$ne': true}};
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
}

function getStats(from, to, cb) {
    if (!cb) {
        return;
    }

    var query = {'merged_to': null, 'data.is_retweet': {'$ne': true}};

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
        {'$match': _.extend({}, query, settings.POSTS_FILTER)},
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

        var count_all = 0;
        var count_twitter = 0;
        var count_facebook = 0;
        var stats = [];
        _.each(results, function (result, i, list) {
            if (timespans.length > 2) {
                // With year + day of the year, date is easily determined
                var timestamp = moment.utc(result._id.year + '-' + (result._id.dayOfYear || '0') + '-' + (result._id.hour || '0') + '-' + (result._id.minute || '0'), 'YYYY-DDD-HH-mm')
            }
            else {
                // Without day of the year, we have to find the start of the week date
                if (result._id.week === 0) {
                    if (stats.length > 0) {
                        // If previous year exist, count towards previous year
                        stats[stats.length - 1][1] += result.count_all;
                        stats[stats.length - 1][2] += result.count_twitter;
                        stats[stats.length - 1][3] += result.count_facebook;

                        count_all += result.count_all;
                        count_twitter += result.count_twitter;
                        count_facebook += result.count_facebook;
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

            count_all += result.count_all;
            count_twitter += result.count_twitter;
            count_facebook += result.count_facebook;
        });

        cb(null, stats, count_all, count_twitter, count_facebook);
    });
}

function getEvents(cb) {
    if (!cb) {
        return;
    }

    models.FacebookEvent.find({}, models.FacebookEvent.PUBLIC_FIELDS).sort({'data.start_time': 1}).lean(true).exec(function (err, events) {
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

function renderPosts(cb) {
    getPosts(null, null, 1000, function (err, posts) {
        if (err) {
            cb(err);
            return;
        }

        posts = _.map(posts, function (post, i, list) {
            try {
                return render.post(post);
            }
            catch (e) {
                console.log("Error rendering post %s: %s", post.foreign_id, e, e.stack);
                return '';
            }
        });

        cb(null, posts.join(''));
    });
}

function renderEvents(cb) {
    getEvents(function (err, events) {
        if (err) {
            cb(err);
            return;
        }

        events = _.map(events, function (event, i, list) {
            try {
                return render.event(event, true);
            }
            catch (e) {
                console.log("Error rendering event %s: %s", event.event_id, e, e.stack);
                return '';
            }
        });

        cb(null, events.join(''));
    });
}

var sock = shoe(function (stream) {
    var d = dnode({
        'getPosts': getPosts,
        'getStats': getStats,
        'getEvents': getEvents
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
            console.warn("Twitter stream disconnected");
            // TODO: Back-off
            connectToTwitterStream();
        }).on('destroy', function (res) {
            console.warn("Twitter stream disconnected");
            // TODO: Back-off
            connectToTwitterStream();
        }).on('error', function (error, statusCode) {
            console.error("Twitter stream error: %s", error, statusCode);
        });
    });
}

function fetchTwitterLatest(cb_main) {
    // TODO: Should we simply automatically start loading all tweets until we find one existing in the database?

    var query = settings.TWITTER_QUERY.slice(0);

    function fetch_one() {
        var q = query.slice(0, settings.TWITTER_MAX_QUERY_SIZE);
        query = query.slice(settings.TWITTER_MAX_QUERY_SIZE);

        if (q.length === 0) {
            if (cb_main) cb_main();
            return;
        }

        console.log("Doing Twitter fetch: %s", q);

        var params = {'include_entities': true, 'count': 100, 'q': q.join(' OR ')};
        twit.get('/search/tweets.json', params, function(err, data) {
            if (err) {
                console.error("Twitter fetch error (%s)", q, err);
                setTimeout(fetch_one, settings.TWITTER_REQUEST_INTERVAL);
                return;
            }

            async.forEach(data.statuses, function (tweet, cb_tweet) {
                models.Post.storeTweet(tweet, 'search', function (err, tweet) {
                    notifyClients(err, tweet);
                    // We handle error independently
                    cb_tweet(null);
                });
            }, function (err) {
                console.log("Twitter fetch done: %s", q);
                setTimeout(fetch_one, settings.TWITTER_REQUEST_INTERVAL);
            });
        });
    }

    fetch_one();
}

function fetchFacebookLatest(limit, cb_main) {
    async.forEachSeries(settings.FACEBOOK_QUERY, function (keyword, cb_keyword) {
        console.log("Doing Facebook search: %s", keyword);

        facebook.request('search?type=post&q=' + encodeURIComponent(keyword), limit, function (err, body) {
            if (err) {
                console.error("Facebook search error (%s): %s", keyword, err);
                // We handle error independently
                cb_keyword(null);
                return;
            }

            async.forEach(body.data, function (post, cb_post) {
                models.Post.storeFacebookPost(post, 'search', function (err, post, event) {
                    notifyClients(err, post, event);
                    // We handle error independently
                    cb_post(null);
                });
            }, function (err) {
                console.log("Facebook search done: %s", keyword);
                cb_keyword(null);
            });
        });
    }, function (err) {
        if (cb_main) cb_main(null);
    });
}

function fetchFacebookPageLatest(limit, cb_main) {
    console.log("Doing Facebook page fetch");

    facebook.request(settings.FACEBOOK_PAGE_ID + '/tagged', limit, function (err, body) {
        if (err) {
            console.error("Facebook page fetch error: %s", err);
            if (cb_main) cb_main(null);
            return;
        }

        async.forEach(body.data, function (post, cb_post) {
            models.Post.storeFacebookPost(post, 'tagged', function (err, post, event) {
                notifyClients(err, post, event);
                // We handle error independently
                cb_post(null);
            });
        }, function (err) {
            console.log("Facebook page fetch done");
            if (cb_main) cb_main(null);
        });
    });
}

// We ignore the limit, but just to have the same function signature as others
function fetchFacebookPageLatestAlternative(limit, cb_main) {
    console.log("Doing Facebook page alternative fetch");

    request({
        'url': 'https://www.facebook.com/' + settings.FACEBOOK_PAGE_ID + '?filter=2',
        'headers': {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.7; rv:18.0) Gecko/20100101 Firefox/18.0'
        }
    }, function (error, res, body) {
        if (error || !res || res.statusCode !== 200) {
            console.error("Facebook page alternative fetch error", error, res && res.statusCode, body);
            if (cb_main) cb_main(null);
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
                var href = $(link).attr('href');
                var post_match = FACEBOOK_POST_ID_REGEXP.exec(href);
                if (post_match) {
                    post_ids.push(post_match[1]);
                    return;
                }
                if (FACEBOOK_POST_PERMALINK_REGEXP.test(href)) {
                    // Link is a permalink, we cannot do anything with story_fbid
                    return;
                }

                console.warn("Facebook page alternative fetch found link, but doesn't match: %s", href);
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

        async.forEachSeries(post_ids, function (post_id, post_cb) {
            facebook.request(post_id, null, function (err, body) {
                if (err) {
                    // Silenced, because we are guessing IDs here and some are not correct
                    //console.error("Facebook page alternative fetch error (%s): %s", post_id, err);
                    // We handle error independently
                    post_cb(null)
                }
                else if (body.from) {
                    // Try to get post version with more information
                    facebook.request(body.from.id + '_' + post_id, null, function (err, better_body) {
                        if (err) {
                            // We will have to use more limited version, it seems
                            better_body = body;
                        }

                        models.Post.storeFacebookPost(better_body, 'taggedalt', function (err, post, event) {
                            notifyClients(err, post, event);
                            // We handle error independently
                            post_cb(null);
                        });
                    });
                }
                else {
                    console.warn("Facebook page alternative fetch found post, but without from: %s", post_id);
                    post_cb(null);
                }
            });
        }, function (err) {
            async.forEachSeries(post_ids2, function (post_id, post_cb) {
                facebook.request(post_id, null, function (err, body) {
                    if (err) {
                        // Silenced, because we are guessing IDs here and some are not correct
                        //console.error("Facebook page alternative fetch error (%s): %s", post_id, err);
                        // We handle error independently
                        post_cb(null);
                    }
                    else {
                        models.Post.storeFacebookPost(body, 'taggedalt', function (err, post, event) {
                            notifyClients(err, post, event);
                            // We handle error independently
                            post_cb(null);
                        });
                    }
                });
            }, function (err) {
                console.log("Facebook page alternative fetch done");
                if (cb_main) cb_main(null);
            });
        });
    });
}

function fetchFacebookRecursiveEventsLatest(limit, cb_main) {
    models.FacebookEvent.find({'recursive': true}, function (err, events) {
        if (err) {
            console.error("Facebook recursive events fetch error: %s", err);
            if (cb_main) cb_main(null);
            return;
        }

        async.forEachSeries(events, function (event, cb_event) {
            console.log("Doing Facebook recursive event fetch: %s", event.event_id);

            facebook.request(event.event_id + '/feed', limit, function (err, body) {
                if (err) {
                    console.error("Facebook recursive events fetch error (%s): %s", event.event_id, err);
                    // We handle error independently
                    cb_event(null);
                    return;
                }

                async.forEach(body.data, function (post, cb_post) {
                    models.Post.storeFacebookPost(post, ['event', 'event/' + event.event_id], function (err, post, event) {
                        notifyClients(err, post, event);
                        // We handle error independently
                        cb_post(null);
                    });
                }, function (err) {
                    console.log("Facebook recursive event fetch done: %s", event.event_id);
                    cb_event(null);
                });
            });
        }, function (err) {
            if (cb_main) cb_main(null);
        });
    });
}

function fetchFacebookAuthorsLatest(limit, cb_main) {
    models.Author.find({'type': 'facebook'}, function (err, authors) {
        if (err) {
            console.error("Facebook authors fetch error: %s", err);
            if (cb_main) cb_main(null);
            return;
        }

        async.forEachSeries(authors, function (author, cb_author) {
            console.log("Doing Facebook authors fetch: %s", author.foreign_id);

            facebook.request(author.foreign_id + '/feed', limit, function (err, body) {
                if (err) {
                    console.error("Facebook authors fetch error (%s): %s", author.foreign_id, err);
                    // We handle error independently
                    cb_author(null);
                    return;
                }

                async.forEach(body.data, function (post, cb_post) {
                    var text = models.Post.getText(post);
                    if (FACEBOOK_QUERY_REGEXP.test(text)) {
                        models.Post.storeFacebookPost(post, ['author', 'author/' + author.foreign_id], function (err, post, event) {
                            notifyClients(err, post, event);
                            // We handle error independently
                            cb_post(null);
                        });
                    }
                    else {
                        cb_post(null);
                    }
                }, function (err) {
                    console.log("Facebook authors fetch done: %s", author.foreign_id);
                    cb_author(null);
                });
            });
        }, function (err) {
            if (cb_main) cb_main(null);
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

function pollFacebook(f) {
    // The first time we don't limit
    f(0, function (err) {
        // We enqueue next polling
        function polling() {
            f(1000, function (err) {
                setTimeout(polling, settings.FACEBOOK_POLL_INTERVAL);
            });
        }
        setTimeout(polling, settings.FACEBOOK_POLL_INTERVAL);
    });
}

models.once('ready', function () {
    if (twit) {
        fetchTwitterLatest();

        connectToTwitterStream();
    }
    else {
        console.warn("Not fetching content from Twitter.");
    }

    if (models && settings.FACEBOOK_ACCESS_TOKEN) {
        pollFacebook(fetchFacebookLatest);
        pollFacebook(fetchFacebookPageLatest);
        pollFacebook(fetchFacebookPageLatestAlternative);
        pollFacebook(fetchFacebookRecursiveEventsLatest);
        pollFacebook(fetchFacebookAuthorsLatest);

        enableFacebookStream();
    }
    else {
        console.warn("Not fetching content from Facebook.");
    }
});

function keepAlive() {
    request(settings.SITE_URL, function (error, res, body) {
        if (error || !res || res.statusCode !== 200) {
            console.error("Keep alive error: %s", settings.SITE_URL, error, res && res.statusCode, body);
        }
    });
}

setInterval(keepAlive, settings.KEEP_ALIVE_INTERVAL);
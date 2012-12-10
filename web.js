var http = require('http');
var url = require('url');
var shoe = require('shoe');
var ecstatic = require('ecstatic')(__dirname + '/static');
var dnode = require('dnode');
var twitter = require('ntwitter');
var swig = require('swig');
var request = require('request');

var $ = require('jquery');

var settings = require('./settings');
var models = require('./models');

swig.init({
    'root': __dirname + '/templates'
});

var facebookTemplate = swig.compileFile('facebook.html');

var server = http.createServer(function (req, res) {
    var req_url = url.parse(req.url, true);
    switch (req_url.pathname) {
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
                    fetchFacebookLatest(100);
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
        'getPosts': function (start, limit, cb) {
            limit = parseInt(limit) || settings.MAX_POSTS_PER_REQUEST;
            if ((limit <= 0) || (limit > settings.MAX_POSTS_PER_REQUEST)) {
                limit = settings.MAX_POSTS_PER_REQUEST;
            }
            // TODO: Implement support for start
            // TODO: Once implemented, make client load new posts when it scrolls to the end of the page
            models.Post.find({}, {'type': true, 'foreign_id': true, 'foreign_timestamp': true, 'data': true}).sort({'foreign_timestamp': 'desc'}).limit(limit).lean(true).exec(function (err, posts) {
                if (err) {
                    cb(err);
                    return;
                }

                posts = $.map(posts, function (post, i) {
                    post.fetch_timestamp = post._id.getTimestamp();
                    delete post._id;
                    return post;
                });

                cb(null, posts);
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

function connectToTwitterStream() {
    console.log("Twitter stream connecting");
    twit.stream('statuses/filter', {'track': settings.TWITTER_QUERY}, function (stream) {
        console.log("Twitter stream connected");
        stream.on('data', function (data) {
            models.storeTweet(data);
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
    // We use both count and rpp to be compatibile with various Twitter API versions (and older ntwitter versions)
    twit.search(settings.TWITTER_QUERY.join(' OR '), {'include_entities': true, 'count': 100, 'rpp': 100}, function(err, data) {
        if (err) {
            console.error("Twitter fetch error: %s", err);
            return;
        }

        $.each(data.results, function (i, tweet) {
            models.storeTweet(tweet);
        });
    });
}

fetchTwitterLatest();
connectToTwitterStream();

function fetchFacebookLatest(limit) {
    request('https://graph.facebook.com/' + settings.FACEBOOK_PAGE_ID + '/tagged?access_token=' + settings.FACEBOOK_ACCESS_TOKEN + '&limit=' + limit, function (error, res, body) {
        if (error || res.statusCode !== 200) {
            console.error("Facebook fetch error", error, res.statusCode, body);
            return;
        }

        try {
            body = JSON.parse(body);
        }
        catch (e) {
            console.error("Facebook fetch error", e);
            return;
        }

        $.each(body.data, function (i, post) {
            models.storeFacebookPost(post);
        });
    });
}

function checkFacebookPageAdded(cb) {
    request('https://graph.facebook.com/' + settings.FACEBOOK_PAGE_ID + '/tabs?access_token=' + settings.FACEBOOK_ACCESS_TOKEN, function (error, res, body) {
        if (error || res.statusCode !== 200) {
            console.error("Facebook app check add to the page error", error, res.statusCode, body);
            return;
        }

        try {
            body = JSON.parse(body);
        }
        catch (e) {
            console.error("Facebook app check add to the page error", e);
            return;
        }

        // TODO: Implement check and only if OK, call callback

        console.log("Facebook app %s added to the page %s", settings.FACEBOOK_APP_ID, settings.FACEBOOK_PAGE_ID);
        cb();
    });
}

function addAppToFacebookPage(cb) {
    request.post('https://graph.facebook.com/' + settings.FACEBOOK_PAGE_ID + '/tabs?access_token=' + settings.FACEBOOK_ACCESS_TOKEN + '&app_id=' + settings.FACEBOOK_APP_ID, function (error, res, body) {
        if (error || res.statusCode !== 200) {
            console.error("Facebook app add to the page error", error, res.statusCode, body);
            return;
        }

        checkFacebookPageAdded(cb);
    });
}

function subscribeToFacebook() {
    // TODO: Implement, currently set manually through
    // request.post('https://graph.facebook.com/' + settings.FACEBOOK_APP_ID + '/subscriptions', function (error, res, body) {
}

function enableFacebookStream() {
    addAppToFacebookPage(subscribeToFacebook);
}

// TODO: We should fetch into the past until we get to posts we already have
fetchFacebookLatest(1000);
enableFacebookStream();

function facebookPolling() {
    // TODO: We should fetch into the past until we get to posts we already have
    fetchFacebookLatest(100);
    setTimeout(facebookPolling, settings.FACEBOOK_POLL_INTERVAL);
}

setTimeout(facebookPolling, settings.FACEBOOK_POLL_INTERVAL);

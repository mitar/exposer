var async = require('async');
var moment = require('moment');
var request = require('request');
var twitter = require('ntwitter');

var _ = require('underscore');
var $ = require('jquery');

var models = require('./models');
var settings = require('./settings');

var TWEET_ID_REGEXP = /(\d+)$/;
var INTERVAL = 1 * 60 * 60; // seconds

var twit = new twitter({
    'consumer_key': settings.TWITTER_CONSUMER_KEY,
    'consumer_secret': settings.TWITTER_CONSUMER_SECRET,
    'access_token_key': settings.TWITTER_ACCESS_TOKEN_KEY,
    'access_token_secret': settings.TWITTER_ACCESS_TOKEN_SECRET
});

var count = 0;

function doRequest(query, until_now) {
    if (query.page > 10) {
        console.warn("Too many tweets per interval, page limit reached. Skipping.", query);
        console.log("New tweets until now: %s", count);

        query.page = 1;
        query.offset = 0;
        query.mintime -= INTERVAL;
        query.maxtime -= INTERVAL;
        until_now = 0;
    }

    console.log("Making request", query);

    request({
        'url': 'http://otter.topsy.com/search.json',
        'qs': query
    }, function (error, res, body) {
        if (error || !res || res.statusCode !== 200) {
            console.error("Topsy fetch error", error, res && res.statusCode, body);
            process.exit(1);
            return;
        }

        try {
            body = JSON.parse(body);
        }
        catch (e) {
            console.error("Could not parse Topsy response", e, body);
            process.exit(1);
            return;
        }

        if (body.response.total > 1000) {
            console.warn("Too many tweets per interval, we will not be able to fetch all: %s", body.response.total);
        }
        else {
            console.log("Total tweets for this interval: %s", body.response.total);
        }

        var tweet_ids = _.map(body.response.list, function (tweet, i, list) {
            var tweet_id_match = TWEET_ID_REGEXP.exec(tweet.trackback_permalink);
            if (!tweet_id_match) {
                console.warn("Could not match tweet ID", tweet);
                return null;
            }
            return tweet_id_match[1];
        });

        function processIds() {
            if (tweet_ids.length === 0) {
                console.log("New tweets until now: %s", count);

                until_now += body.response.list.length;
                if (until_now < body.response.total) {
                    query.page += 1;
                    query.offset = body.response.last_offset;

                    doRequest(query, until_now);
                }
                else {
                    query.page = 1;
                    query.offset = 0;
                    query.mintime -= INTERVAL;
                    query.maxtime -= INTERVAL;

                    doRequest(query, 0);
                }

                return;
            }

            var tweet_id = tweet_ids[0];
            tweet_ids = tweet_ids.slice(1);

            if (!tweet_id) { // Not matched ID
                processIds();
                return;
            }

            twit.get('/statuses/show/' + tweet_id + '.json', {'include_entities': true}, function (err, tweet) {
                if (err) {
                    console.error("Twitter fetch error", tweet_id, err);
                    setTimeout(processIds, settings.TWITTER_REQUEST_INTERVAL);
                    return;
                }

                models.Post.storeTweet(tweet, 'search', function (err, tweet) {
                    if (err) {
                        console.error("Twitter store error", err);
                    }

                    if (tweet) {
                        count++;
                    }

                    setTimeout(processIds, settings.TWITTER_REQUEST_INTERVAL);
                });
            });
        }

        processIds();
    });
}

function loadtopsy() {
    var now = process.argv.length > 2 ? parseInt(process.argv[2]) : moment.utc().unix();
    var query = {'perpage': '100', 'page': 1, 'offset': 0, 'maxtime': now, 'mintime': now - INTERVAL, 'q': settings.TWITTER_QUERY.join(' OR '), 'apikey': settings.TOPSY_APIKEY};
    doRequest(query, 0);
}

models.once('ready', function () {
    loadtopsy();
});

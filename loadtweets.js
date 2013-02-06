var async = require('async');
var moment = require('moment');
var twitter = require('ntwitter');

var models = require('./models');
var settings = require('./settings');

var MAX_ID_REGEXP = /max_id=(\d+)/;

var twit = new twitter({
    'consumer_key': settings.TWITTER_CONSUMER_KEY,
    'consumer_secret': settings.TWITTER_CONSUMER_SECRET,
    'access_token_key': settings.TWITTER_ACCESS_TOKEN_KEY,
    'access_token_secret': settings.TWITTER_ACCESS_TOKEN_SECRET
});

var q = settings.TWITTER_QUERY.slice(0, settings.TWITTER_MAX_QUERY_SIZE);
var query = settings.TWITTER_QUERY.slice(settings.TWITTER_MAX_QUERY_SIZE);
var maxId = process.argv.length > 2 ? process.argv[2] : null;
var count = 0;
var date = null;
var errorCount = 0;

function nextQuery() {
    q = query.slice(0, settings.TWITTER_MAX_QUERY_SIZE);
    query = query.slice(settings.TWITTER_MAX_QUERY_SIZE);
    maxId = null;
    date = null;

    if (!q) {
        process.exit(0);
    }
    else {
        setTimeout(loadtweets, settings.TWITTER_REQUEST_INTERVAL);
    }
}

function nextDay() {
    if (!date) {
        date = moment();
    }
    date.subtract('days', 1);
    maxId = null;
    if (moment() - date > 14 * 24 * 60 * 60 * 1000) { // 14 days
        nextQuery();
    }
    else {
        setTimeout(loadtweets, settings.TWITTER_REQUEST_INTERVAL);
    }
}

function loadtweets() {
    var params = {'include_entities': true, 'count': 100, 'max_id': maxId, 'q': q.join(' OR ') + (date ? ' until:' + date.format('YYYY-MM-DD') : '')};
    console.log("Making request, q = %s, max_id = %s, date = %s", q, maxId, date);
    twit.get('/search/tweets.json', params, function(err, data) {
        if (err) {
            if ((err.statusCode === 500 || err.statusCode === 503) && errorCount < 3) {
                console.error("Twitter fetch error, retrying", err);
                errorCount++;
                setTimeout(loadtweets, settings.TWITTER_REQUEST_INTERVAL);
            }
            else {
                console.error("Twitter fetch error", err);
                process.exit(1);
            }
            return;
        }

        errorCount = 0;

        if (data.statuses.length === 0) {
            console.log("%s new tweets fetched overall", count);
            nextDay();
            return;
        }

        async.forEach(data.statuses, function (tweet, cb) {
            models.Post.storeTweet(tweet, 'search', function (err, tweet) {
                if (err) {
                    console.error(err);
                    return;
                }

                if (tweet) {
                    count++;
                }
            });

            // We handle error independently
            cb(null);
        }, function (err) {
            console.log("%s new tweets fetched overall", count);

            var max_id_match = MAX_ID_REGEXP.exec(data.search_metadata.next_results);
            if (!max_id_match) {
                nextDay();
                return;
            }

            maxId = max_id_match[1];

            setTimeout(loadtweets, settings.TWITTER_REQUEST_INTERVAL);
        });
    });
}

loadtweets();

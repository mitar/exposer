var async = require('async');
var twitter = require('ntwitter');

var models = require('./models');
var settings = require('./settings');

// Rate limit is 180 requests per 15 minutes
// TODO: Use limiter for proper limiting of all Tweeter requests
var LOAD_INTERVAL = 15 * 60 * 1000 / 180;
var MAX_ID_REGEXP = /max_id=(\d+)/;

var twit = new twitter({
    'consumer_key': settings.TWITTER_CONSUMER_KEY,
    'consumer_secret': settings.TWITTER_CONSUMER_SECRET,
    'access_token_key': settings.TWITTER_ACCESS_TOKEN_KEY,
    'access_token_secret': settings.TWITTER_ACCESS_TOKEN_SECRET
});

var max_id = process.argv.length > 2 ? process.argv[2] : null;
var count = 0;

function loadtweets() {
    var params = {'include_entities': true, 'count': 100, 'max_id': max_id, 'q': settings.TWITTER_QUERY.join(' OR ')};
    console.log("Making request, max_id = %s", max_id);
    twit.get('/search/tweets.json', params, function(err, data) {
        if (err) {
            console.error("Twitter fetch error", err);
            process.exit(1);
            return;
        }

        if (data.statuses.length === 0) {
            console.log("%s new tweets fetched overall", count);
            process.exit(0);
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
                process.exit(0);
                return;
            }

            max_id = max_id_match[1];

            setTimeout(loadtweets, LOAD_INTERVAL);
        });
    });
}

loadtweets();

var twitter = require('ntwitter');

var $ = require('jquery');

var settings = require('./settings');
var models = require('./models');

// Rate limit is 180 requests per 15 minutes
var LOAD_INTERVAL = 15 * 60 * 1000 / 180;

var twit = new twitter({
    'consumer_key': settings.TWITTER_CONSUMER_KEY,
    'consumer_secret': settings.TWITTER_CONSUMER_SECRET,
    'access_token_key': settings.TWITTER_ACCESS_TOKEN_KEY,
    'access_token_secret': settings.TWITTER_ACCESS_TOKEN_SECRET
});

var page = 1;

function loadtweets() {
    // We use both count and rpp to be compatibile with various Twitter API versions (and older ntwitter versions)
    twit.search(settings.TWITTER_QUERY.join(' OR '), {'include_entities': true, 'count': 100, 'rpp': 100, 'page': page}, function(err, data) {
        if (err) {
            console.error("Twitter fetch error: %s", err);
            return;
        }

        $.each(data.results, function (i, tweet) {
            models.storeTweet(tweet);
        });

        page++;

        // Rate limit is 180 requests per 15 minutes
        setTimeout(loadtweets, LOAD_INTERVAL);
    });
}

loadtweets();
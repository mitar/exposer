var assert = require('assert');
var twitter = require('ntwitter');
var util = require('util');

var _ = require('underscore');

var models = require('./models');
var settings = require('./settings');

var twit = new twitter({
    'consumer_key': settings.TWITTER_CONSUMER_KEY,
    'consumer_secret': settings.TWITTER_CONSUMER_SECRET,
    'access_token_key': settings.TWITTER_ACCESS_TOKEN_KEY,
    'access_token_secret': settings.TWITTER_ACCESS_TOKEN_SECRET
});

var QUERY_REGEX = new RegExp(settings.TWITTER_QUERY.join('|'), 'i');

var newCount = 0;
var alreadyHaveCount = 0;
var withoutQueryCount = 0;
var missingCount = 0;

var id = null;
var ids = [];
var errorCount = 0;

function regexMatch(obj) {
    for (var field in obj) {
        if (obj.hasOwnProperty(field)) {
            if (QUERY_REGEX.test(obj[field])) {
                return true;
            }
            if (typeof(obj[field]) === 'object' && regexMatch(obj[field])) {
                return true;
            }
        }
    }
    return false;
}

function nextId() {
    id = ids[0];
    ids = ids.slice(1);

    if (id) {
        setTimeout(processIds, settings.TWITTER_REQUEST_INTERVAL);
    }
    else {
        console.log("newCount: %s", newCount);
        console.log("alreadyHaveCount: %s", alreadyHaveCount);
        console.log("withoutQueryCount: %s", withoutQueryCount);
        console.log("missingCount: %s", missingCount);
        process.exit(0);
    }
}

function processIds() {
    models.Post.where('foreign_id', id).count(function (err, count) {
        if (err) {
            console.error(err);
            nextId();
            return;
        }

        if (count > 0) {
            console.warn("Tweet existing", id);
            alreadyHaveCount++;
            nextId();
            return;
        }

        var params = {'include_entities': true, 'include_my_retweet': false, 'trim_user': false, 'id': id};
        console.log("Making request, id = %s", id);
        twit.get('/statuses/show.json', params, function(err, data) {
            if (err) {
                if ((err.statusCode === 500 || err.statusCode === 503) && errorCount < 3) {
                    console.error("Twitter fetch error, retrying", err);
                    errorCount++;
                    setTimeout(processIds, settings.TWITTER_REQUEST_INTERVAL);
                }
                else if (err.statusCode === 404) {
                    console.warn("Tweet not found", err);
                    missingCount++;
                    nextId();
                }
                else {
                    console.error("Twitter fetch error", err);
                    process.exit(1);
                }
                return;
            }

            if (!regexMatch(data)) {
                console.warn("Tweet skipped", util.inspect(data, false, null));
                withoutQueryCount++;
                nextId();
                return;
            }

            models.Post.storeTweet(data, 'import', function (err, tweet) {
                if (err) {
                    console.error(err);
                    nextId();
                    return;
                }

                // We know that we do not yet have it
                assert(tweet, tweet);

                newCount++;
                nextId();
            });
        });
    });
}

function importtweets() {
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    var buffer = '';
    process.stdin.on('data', function (chunk) {
        buffer += chunk;
        var lines = buffer.split('\n');
        for (var i = 0; i < lines.length - 1; i++) {
            ids.push(lines[i]);
        }
        buffer = lines[lines.length - 1];
    }).on('end', function () {
        if (buffer) {
            ids.push(buffer);
        }
        id = ids[0];
        ids = ids.slice(1);
        processIds();
    });
}

models.once('ready', function () {
    importtweets();
});

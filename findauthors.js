var async = require('async');

var models = require('./models');
var settings = require('./settings');

var authors = 0;

function findauthors() {
    var query = {
        'type': 'facebook',
        '$where': models.Post.NOT_FILTERED,
        'merged_to': null,
        'data.is_retweet': {'$ne': true}
    };

    models.Post.find(_.extend({}, query, settings.POSTS_FILTER), function (err, posts) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        async.forEach(posts, function (post, cb) {
            if (post.data.from && post.data.from.id) {
                models.Author.findOneAndUpdate({'type': 'facebook', 'foreign_id': post.data.from.id}, {'foreign_name': post.data.from.name || null}, {'upsert': true}, function (err, author) {
                    if (err) {
                        console.error("Post (%s) author (%s) store error: %s",  post.foreign_id, post.data.from.id, err);
                        // We handle error independently
                        cb(null);
                        return;
                    }

                    authors++;
                    cb(null);
                });
            }
            else {
                cb(null);
            }
        }, function (err) {
            console.log("Found %s authors", authors);
            process.exit(0);
        });
    });
}

models.once('ready', function () {
    findauthors();
});
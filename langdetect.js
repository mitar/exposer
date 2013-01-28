var async = require('async');

var _ = require('underscore');

var models = require('./models');

function langdetect() {
    models.Post.find({'type': 'facebook'}).exec(function (err, posts) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        async.forEach(posts, function (post, cb) {
            post.language = models.Post.detectLanguage(post.type, post.data);
            post.save(function (err, obj) {
                if (err) {
                    console.error(err);
                }
                // We handle error independently
                cb(null);
            });
        }, function (err) {
            process.exit(0);
        });
    });
}

langdetect();

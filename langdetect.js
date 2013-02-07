var async = require('async');

var _ = require('underscore');

var models = require('./models');

function langdetect() {
    var all = 0;
    var languages = 0;
    models.Post.find({'type': 'facebook'}).exec(function (err, posts) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        async.forEach(posts, function (post, cb) {
            all++;

            post.language = models.Post.detectLanguage(post.type, post.data);

            if (post.language) {
                languages++;
            }

            post.save(function (err, obj) {
                if (err) {
                    console.error(err);
                }
                // We handle error independently
                cb(null);
            });
        }, function (err) {
            console.log("Detected non-target language on %s of %s posts", languages, all);
            process.exit(0);
        });
    });
}

models.once('ready', function () {
    langdetect();
});

var async = require('async');

var models = require('./models');

function migrate() {
    models.Post.find({'type_foreign_id': null}, function (err, posts) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        console.log("Processing %d posts", posts.length);

        async.forEach(posts, function (post, cb) {
            post.type_foreign_id = post.type + '/' + post.foreign_id;
            post.save(function (err, obj) {
                if (err) {
                    console.error(err)
                }

                // We handle error independently
                cb(null);
            });
        }, function (err) {
            process.exit(0);
        });
    });
}

migrate();

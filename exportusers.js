var _ = require('underscore');

var models = require('./models');

function exportusers() {
    var seenUsers = {};
    models.Post.find({'type': 'twitter'}).exec(function (err, posts) {
        if (err) {
            console.error(err);
            return;
        }

        var users = [];

        _.each(posts, function (post, i, list) {
            if (!seenUsers[post.original_data.user.id_str]) {
                users.push(post.original_data.user);
                seenUsers[post.original_data.user.id_str] = true;
            }
        });

        console.log(JSON.stringify(users));
    });
}

models.once('ready', function () {
    exportusers();
});
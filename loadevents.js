var async = require('async');

var models = require('./models');
var settings = require('./settings');

function loadevents() {
    models.Post.find({'type': 'facebook', 'data.type': 'link', 'post.data.link': null}, function (err, posts) {
        if (err) {
            console.error(err);
            return;
        }

        async.forEachSeries(posts, function (post, cb) {
            post.fetchFacebookEvent(function (event) {
                if (event) {
                    console.log("Processed Facebook post and event: %s -> %s (%s)", post.foreign_id, event.event_id, post.facebook_event_id ? "updated" : "new");
                }
                cb(null);
            });
        });
    });
}

loadevents();

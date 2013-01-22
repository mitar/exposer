var async = require('async');

var models = require('./models');
var settings = require('./settings');

function loadevents() {
    models.Post.find({'type': 'facebook', 'data.type': 'link', $or: [{'data.link': null}, {'data.link': models.FacebookEvent.LINK_REGEXP}, {'data.link': models.FacebookEvent.URL_REGEXP}]}, function (err, posts) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        async.forEachSeries(posts, function (post, cb) {
            var first_fetch = !post.facebook_event_id;
            post.fetchFacebookEvent(function (err, event) {
                if (err) {
                    console.error(err);
                }
                else if (event) {
                    console.log("Processed Facebook post and event: %s -> %s (%s)", post.foreign_id, event.event_id, first_fetch ? "new" : "updated");
                }
                // We handle error independently
                cb(null);
            });
        }, function (err) {
            process.exit(0);
        });
    });
}

loadevents();

var async = require('async');

var models = require('./models');

function loadevents() {
    // See postSchema.statics.hasEvent comment for explanation of this query
    models.Post.find({'type': 'facebook', '$or': [{'data.type': 'link'}, {'data.link': {'$ne': null}}], 'data.link': {'$in': [null, models.FacebookEvent.LINK_REGEXP, models.FacebookEvent.URL_REGEXP]}}, function (err, posts) {
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

models.once('ready', function () {
    loadevents();
});

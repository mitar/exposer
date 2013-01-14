var $ = require('jquery');

var facebook = require('./facebook');
var models = require('./models');
var settings = require('./settings');

var FACEBOOK_POST_REGEXP = /(\d+)_(\d+)/;
var FACEBOOK_EVENT_REGEXP = /^\/events\/(\d+)\/$/;

function loadevents() {
    models.Post.find({'type': 'facebook', 'data.type': 'link'}, function (err, posts) {
        if (err) {
            console.error(err);
            return;
        }

        $.each(posts, function (i, post) {
            // TODO: Move to MongoDB query?
            if (post.data.link) {
                return;
            }

            var post_match = FACEBOOK_POST_REGEXP.exec(post.data.id);
            if (post_match) {
                var post_id = post_match[2];
            }
            else {
                console.warning("Facebook post does not have ID: %s", post.foreign_id, post);
                return;
            }
            facebook.request(post_id + '?access_token=' + settings.FACEBOOK_ACCESS_TOKEN, function (body) {
                if (!body.link) {
                    console.error("Facebook post missing link: %s", post.foreign_id, body);
                    return;
                }

                var link_match = FACEBOOK_EVENT_REGEXP.exec(body.link);
                if (!link_match) {
                    console.warning("Facebook post invalid event link: %s", post.foreign_id, body);
                    return;
                }

                var event_id = link_match[1];
                var event_link = body.link;

                if (event_link.substring(0, 4) !== 'http') {
                    event_link = 'https://www.facebook.com' + event_link;
                }

                facebook.request(event_id + '?fields=id,owner,name,description,start_time,end_time,timezone,is_date_only,location,venue,privacy,updated_time,picture&access_token=' + settings.FACEBOOK_ACCESS_TOKEN, function (body) {
                    if (body.picture && body.picture.data) {
                        body.picture = body.picture.data;
                    }

                    post.additional_data = body;
                    post.additional_data.link = event_link;

                    facebook.request(event_id + '/invited?summary=1&access_token=' + settings.FACEBOOK_ACCESS_TOKEN, function (body) {
                        post.additional_data.invited_summary = body.summary;
                        post.save();

                        console.log("Processed Facebook post and event: %s -> %s", post.foreign_id, event_id);
                    });
                });
            });
        });
    });
}

loadevents();

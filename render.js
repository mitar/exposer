var moment = require('moment');

var $ = require('jquery');

var FACEBOOK_ID_REGEXP = /^(\d+)_(\d+)$/;

function renderPost(templates, post) {
    switch (post.type) {
        case 'twitter':
            return templates.twitter({
                'post': post
            });
        case 'facebook':
            var post_id = null;
            var post_link = null;
            var post_match = FACEBOOK_ID_REGEXP.exec(post.data.id);
            if (post_match) {
                post_id = post_match[2];
                post_link = 'https://www.facebook.com/' + post_match[1] + '/posts/' + post_match[2];
            }
            else if (post.data.from && post.data.from.id) {
                post_link = 'https://www.facebook.com/' + post.data.from.id + '/posts/' + post.data.id;
            }
            else {
                console.warn("Facebook post does not have a link and ID: %s", post.foreign_id, post);
            }

            // Override with a better version
            if (post.data.actions && post.data.actions.length > 0 && post.data.actions[0].link) {
                post_link = post.data.actions[0].link.split('http://').join('https://');
            }

            if (post.data.actions) {
                $.each(post.data.actions, function (i, action) {
                    post.data.actions[action.name.toLowerCase()] = action;
                });
            }

            var event_in_past = false;
            if (post.facebook_event) {
                if (moment(post.facebook_event.start_time) < moment()) {
                    event_in_past = true;
                }
            }

            var like_link = null;
            if (post.facebook_event) {
                like_link = post.facebook_event.data.link;
            }
            else if (post.data.link) {
                like_link = post.data.link;
            }
            else if (post.data.actions.like) {
                like_link = post.data.actions.like.link;
            }
            else {
                like_link = post_link;
            }

            return templates.facebook({
                'post': post,
                'post_link': post_link,
                'post_id': post_id,
                'event': post.facebook_event,
                'event_in_past': event_in_past,
                'like_link': like_link
            });
        default:
            console.error("Unknown post type: %s", post.type, post);
            return null;
    }
}

function renderEvent(templates, event, show_description) {
    var event_in_past = false;
    if (moment(event.start_time) < moment()) {
        event_in_past = true;
    }

    return templates.event({
        'event': event,
        'event_in_past': event_in_past,
        'show_description': show_description
    });
}

module.exports = function (templates) {
    return {
        'post': function (post) {
            return renderPost(templates, post);
        },
        'event': function (event, show_description) {
            return renderEvent(templates, event, show_description);
        }
    }
};
var mongoose = require('mongoose');

var _ = require('underscore');

var facebook = require('./facebook');
var settings = require('./settings');

var FACEBOOK_POST_REGEXP = /(\d+)_(\d+)/;
var FACEBOOK_EVENT_REGEXP = /^\/events\/(\d+)\/$/;

var db = mongoose.createConnection(settings.MONGODB_URL).on('error', function (err) {
    console.error("MongoDB connection error: %s", err);
    // TODO: Handle better, depending on the error?
    throw new Error("MongoDB connection error");
}).once('open', function () {
    console.log("MongoDB connection successful");
});

var postSchema = mongoose.Schema({
    'type': {
        'type': String,
        'required': true
    },
    'foreign_id': {
        'type': String,
        'unique': true,
        'required': true
    },
    'foreign_timestamp': {
        'type': Date,
        'index': true,
        'required': true
    },
    'data': {
        'type': mongoose.Schema.Types.Mixed,
        'required': true
    },
    'original_data': {
        'type': mongoose.Schema.Types.Mixed,
        'required': false
    },
    'facebook_event_id': {
        'type': String,
        'required': false
    }
});

postSchema.statics.NOT_FILTERED =
    " \
        function () { \
            function regexMatch(obj) { \
                for (var field in obj) { \
                    if (obj.hasOwnProperty(field)) { \
                        if (/" + settings.FACEBOOK_QUERY.join('|') + "/i.test(obj[field])) { \
                            return true; \
                        } \
                        if (typeof(obj[field]) === 'object' && regexMatch(obj[field])) { \
                            return true; \
                        } \
                    } \
                } \
                return false; \
            } \
            if (this.type === 'facebook') { \
                return regexMatch(this); \
            } \
            else { \
                return true; \
            } \
        } \
    ";

postSchema.methods.fetchFacebookEvent = function (callback) {
    var post = this;

    if (post.data.type !== 'link' || post.data.link) {
        // Not a link to a Facebook event
        callback(null);
        return;
    }

    var post_match = FACEBOOK_POST_REGEXP.exec(post.data.id);
    if (post_match) {
        var post_id = post_match[2];
    }
    else {
        console.warning("Facebook post does not have ID: %s", post.foreign_id, post);
        callback(null);
        return;
    }
    facebook.request(post_id + '?access_token=' + settings.FACEBOOK_ACCESS_TOKEN, function (body) {
        if (!body.link) {
            console.error("Facebook post missing link: %s", post.foreign_id, body);
            callback(null);
            return;
        }

        var link_match = FACEBOOK_EVENT_REGEXP.exec(body.link);
        if (!link_match) {
            console.warning("Facebook post invalid event link: %s", post.foreign_id, body);
            callback(null);
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

            var event = {
                'event_id': event_id,
                'data': body
            };
            event.data.link = event_link;

            facebook.request(event_id + '/invited?summary=1&access_token=' + settings.FACEBOOK_ACCESS_TOKEN, function (body) {
                event.invited_summary = body.summary;
                event.invited = body.data;

                function fetchInvited(body) {
                    if (body.paging && body.paging.next) {
                        facebook.request(body.paging.next + '&access_token=' + settings.FACEBOOK_ACCESS_TOKEN, function (body) {
                            event.invited.push.apply(event.invited, body.data);
                            fetchInvited(body);
                        });
                    }
                    else {
                        FacebookEvent.findOneAndUpdate({'event_id': event_id}, event, {'upsert': true}, function (err, facebook_event) {
                            if (err) {
                                console.error("Facebook event (%s) store error: %s", event_id, err);
                                callback(null);
                                return;
                            }

                            facebook_event.fetch_timestamp = facebook_event._id.getTimestamp();
                            delete facebook_event._id;

                            post.facebook_event_id = facebook_event.event_id;
                            post.save(function (err, obj) {
                                if (err) {
                                    console.error("Facebook post (%s) store error: %s", post.foreign_id, err);
                                    callback(null);
                                    return;
                                }

                                callback(_.pick(facebook_event, 'event_id', 'data', 'invited_summary', 'fetch_timestamp'));
                            });
                        });
                    }
                }

                fetchInvited(body);
            });
        });
    });
};

postSchema.statics.fetchFacebookEvent = function (post_id, callback) {
    Post.findOne(_.extend({}, settings.POSTS_FILTER, {'foreign_id': post_id, 'type': 'facebook'})).exec(function (err, post) {
        if (err) {
            console.error("Post (%s/%s) load error: %s", 'facebook', post_id, err);
            callback(null);
            return;
        }

        post.fetchFacebookEvent(callback);
    });
};

postSchema.statics.storeTweet = function (tweet, callback) {
    var data = {
        'from_user': tweet.from_user || tweet.user.screen_name,
        'in_reply_to_status_id': tweet.in_reply_to_status_id,
        'in_reply_to_status_id_str': tweet.in_reply_to_status_id_str,
        'text': tweet.text
    };

    storePost(tweet.id_str, 'twitter', new Date(tweet.created_at), data, tweet, callback);
};

postSchema.statics.storeFacebookPost = function (post, callback) {
    storePost(post.id, 'facebook', new Date(post.created_time), post, null, function (callback_post) {
        var new_event = !callback_post.facebook_event_id;
        delete callback_post.facebook_event_id;

        // We check callback_post here, too, to optimize database access
        if (callback_post.data.type === 'link' && !callback_post.data.link) {
            // We fetch Facebook event for the first time or update existing
            Post.fetchFacebookEvent(post.id, function (event) {
                callback_post.facebook_event = event;
                callback(callback_post, new_event ? event : null);
            });
        }
        else {
            callback(callback_post, null);
        }
    });
};

var Post = db.model('Post', postSchema);

var facebookEventSchema = mongoose.Schema({
    'event_id': {
        'type': String,
        'unique': true,
        'required': true
    },
    'data': {
        'type': mongoose.Schema.Types.Mixed,
        'required': true
    },
    'invited_summary': {
        'type': mongoose.Schema.Types.Mixed,
        'required': true
    },
    'invited': [{
        'type': mongoose.Schema.Types.Mixed,
        'required': false
    }]
});

var FacebookEvent = db.model('FacebookEvent', facebookEventSchema);

function storePost(foreign_id, type, foreign_timestamp, data, original_data, callback) {
    var query = {'foreign_id': foreign_id, 'type': type};
    // TODO: Does this clear event_id on update?
    Post.findOneAndUpdate(query, {'foreign_timestamp': foreign_timestamp, 'data': data, 'original_data': original_data}, {'upsert': true, 'new': false}, function (err, obj) {
        if (err) {
            console.error("Post (%s/%s) store error: %s", type, foreign_id, err);
            return;
        }

        if (!obj.toObject()) {
            // Post was not already stored
            // We load post manually, because to know if post was stored or not we
            // do not set "new" parameter of findOneAndUpdate call
            // We also want just some fields and a lean object
            Post.findOne(_.extend({}, {'$where': Post.NOT_FILTERED}, settings.POSTS_FILTER, query), {'type': true, 'foreign_id': true, 'foreign_timestamp': true, 'data': true, 'facebook_event_id': true}).lean(true).exec(function (err, post) {
                if (err) {
                    console.error("Post (%s/%s) load error: %s", type, foreign_id, err);
                    return;
                }

                if (!post) {
                    // Filtered out
                    return;
                }

                post.fetch_timestamp = post._id.getTimestamp();
                delete post._id;

                if (!post.facebook_event_id) {
                    // If false, null, or non-existent, we remove it (so that it is not available in tweets, for example
                    delete post.facebook_event_id;
                }

                if (callback) {
                    callback(post);
                }
            });
        }
    });
}

exports.Post = Post;
exports.FacebookEvent = FacebookEvent;

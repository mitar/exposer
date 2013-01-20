var mongoose = require('mongoose');
var util = require('util');

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
        'index': true,
        'required': true
    },
    'foreign_id': {
        'type': String,
        'index': true,
        'required': true
    },
    'type_foreign_id': {
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
    'sources': [{
        'type': String,
        'required': false
    }],
    'facebook_event_id': {
        'type': String,
        'index': true,
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
            function trusted() { \
                for (var i in this) { \
                    if (this[i] === 'tagged') { \
                        return true; \
                    } \
                } \
                return false; \
            } \
            if (this.type === 'facebook') { \
                return trusted() || regexMatch(this); \
            } \
            else { \
                return true; \
            } \
        } \
    ";

postSchema.methods.fetchFacebookEvent = function (cb) {
    var post = this;

    if (post.data.type !== 'link' || post.data.link) {
        // Not a link to a Facebook event
        cb(null, null);
        return;
    }

    var post_match = FACEBOOK_POST_REGEXP.exec(post.foreign_id);
    if (post_match) {
        var post_id = post_match[2];
    }
    else {
        cb("Facebook post ID does not match regex: " + post.foreign_id);
        return;
    }

    facebook.request(post_id, function (err, body) {
        if (err) {
            cb(err);
            return;
        }

        if (!body.link) {
            cb("Facebook post (" + post.foreign_id + ") is missing link: " + util.inspect(body));
            return;
        }

        var link_match = FACEBOOK_EVENT_REGEXP.exec(body.link);
        if (!link_match) {
            cb("Facebook post (" + post.foreign_id + ") has invalid event link: " + util.inspect(body));
            return;
        }

        var event_id = link_match[1];
        var event_link = body.link;

        if (event_link.substring(0, 4) !== 'http') {
            event_link = 'https://www.facebook.com' + event_link;
        }

        facebook.request(event_id + '?fields=id,owner,name,description,start_time,end_time,timezone,is_date_only,location,venue,privacy,updated_time,picture', function (err, body) {
            if (err) {
                cb(err);
                return;
            }

            if (body.picture && body.picture.data) {
                body.picture = body.picture.data;
            }

            var event = {
                'event_id': event_id,
                'data': body,
                '$addToSet': {'posts': post.foreign_id}
            };
            event.data.link = event_link;

            facebook.request(event_id + '/invited?summary=1', function (err, body) {
                if (err) {
                    cb(err);
                    return;
                }

                event.invited_summary = body.summary;
                event.invited = body.data;

                function fetchInvited(body) {
                    if (body.paging && body.paging.next) {
                        facebook.request(body.paging.next, function (err, body) {
                            if (err) {
                                cb(err);
                                return;
                            }

                            event.invited.push.apply(event.invited, body.data);
                            fetchInvited(body);
                        });
                    }
                    else {
                        FacebookEvent.findOneAndUpdate({'event_id': event_id}, event, {'upsert': true}, function (err, facebook_event) {
                            if (err) {
                                cb("Facebook event (" + event_id + ") store error: " + err);
                                return;
                            }

                            facebook_event.postFetch(function (err) {
                                if (err) {
                                    cb("Facebook event (" + event_id + ") post fetch error: " + err);
                                    return;
                                }

                                facebook_event = facebook_event.toObject();
                                facebook_event.fetch_timestamp = facebook_event._id.getTimestamp();
                                delete facebook_event._id;

                                post.facebook_event_id = facebook_event.event_id;
                                post.save(function (err, obj) {
                                    if (err) {
                                        cb("Facebook post (" + post.foreign_id + ") store error: " + err);
                                        return;
                                    }

                                    cb(null, _.pick(facebook_event, 'event_id', 'data', 'invited_summary', 'fetch_timestamp'));
                                });
                            });
                        });
                    }
                }

                fetchInvited(body);
            });
        });
    });
};

postSchema.statics.fetchFacebookEvent = function (post_id, cb) {
    Post.findOne(_.extend({}, settings.POSTS_FILTER, {'foreign_id': post_id, 'type': 'facebook'})).exec(function (err, post) {
        if (err) {
            cb("Facebook post (" + post_id + ") load error: " + err);
            return;
        }

        post.fetchFacebookEvent(cb);
    });
};

postSchema.statics.storeTweet = function (tweet, source, cb) {
    var data = {
        'from_user': tweet.from_user || tweet.user.screen_name,
        'in_reply_to_status_id': tweet.in_reply_to_status_id,
        'in_reply_to_status_id_str': tweet.in_reply_to_status_id_str,
        'text': tweet.text
    };

    storePost(tweet.id_str, 'twitter', new Date(tweet.created_at), source, data, tweet, cb);
};

postSchema.statics.storeFacebookPost = function (post, source, cb) {
    storePost(post.id, 'facebook', new Date(post.created_time), source, post, null, function (err, callback_post) {
        if (err) {
            cb(err);
            return;
        }

        if (!callback_post) {
            cb(null, null);
            return;
        }

        var new_event = !callback_post.facebook_event_id;
        delete callback_post.facebook_event_id;

        // We check callback_post here, too, to optimize database access
        if (callback_post.data.type === 'link' && !callback_post.data.link) {
            // We fetch Facebook event for the first time or update existing
            Post.fetchFacebookEvent(post.id, function (err, event) {
                if (err) {
                    // Just log the error and continue
                    console.error(err);
                }

                event = event || null;

                callback_post.facebook_event = event;
                cb(null, callback_post, new_event ? event : null);
            });
        }
        else {
            cb(null, callback_post, null);
        }
    });
};

postSchema.statics.createTypeForeignId = function (type, foreign_id) {
    return type + '/' + foreign_id;
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
    }],
    'posts': [{
        'type': String,
        'required': false
    }],
    'recursive': {
        'type': Boolean,
        'index': true,
        'required': true
    }
});

facebookEventSchema.methods.postFetch = function (cb) {
    var event = this;

    Post.find(_.extend({}, {'type': 'facebook', 'sources': 'tagged', 'foreign_id': {'$in': event.posts}}, settings.POSTS_FILTER)).count(function (err, count) {
        if (err) {
            cb(err);
            return;
        }

        event.recursive = count > 0;
        event.save(function (err, obj) {
            cb(err);
        });
    });
};

var FacebookEvent = db.model('FacebookEvent', facebookEventSchema);

function storePost(foreign_id, type, foreign_timestamp, source, data, original_data, cb) {
    var query = {'foreign_id': foreign_id, 'type': type};

    if (!_.isArray(source)) {
        source = [source];
    }

    Post.findOneAndUpdate(query, {'type_foreign_id': Post.createTypeForeignId(type, foreign_id), 'foreign_timestamp': foreign_timestamp, '$addToSet': {'sources': {'$each': source}}, 'data': data, 'original_data': original_data}, {'upsert': true, 'new': false}, function (err, obj) {
        if (err) {
            cb("Post (" + Post.createTypeForeignId(type, foreign_id) + ") store error: " + err);
            return;
        }

        if (!obj.toObject()) {
            // Post was not already stored
            // We load post manually, because to know if post was stored or not we
            // do not set "new" parameter of findOneAndUpdate call
            // We also want just some fields and a lean object
            Post.findOne(_.extend({}, {'$where': Post.NOT_FILTERED}, settings.POSTS_FILTER, query), {'type': true, 'foreign_id': true, 'foreign_timestamp': true, 'data': true, 'facebook_event_id': true}).lean(true).exec(function (err, post) {
                if (err) {
                    cb("Post (" + Post.createTypeForeignId(type, foreign_id) + ") load error: " + err);
                    return;
                }

                if (!post) {
                    // Filtered out
                    cb(null, null);
                    return;
                }

                post.fetch_timestamp = post._id.getTimestamp();
                delete post._id;

                if (!post.facebook_event_id) {
                    // If false, null, or non-existent, we remove it (so that it is not available in tweets, for example
                    delete post.facebook_event_id;
                }

                cb(null, post);
            });
        }
        else {
            // Post was already stored
            cb(null, null);
        }
    });
}

exports.Post = Post;
exports.FacebookEvent = FacebookEvent;

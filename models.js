var mongoose = require('mongoose');
var util = require('util');

var _ = require('underscore');

var facebook = require('./facebook');
var settings = require('./settings');

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
    },
    'merged_to': {
        'type': String
    },
    'merged_from': [{
        'type': String
    }]
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
            function trusted(sources) { \
                for (var i in sources) { \
                    if (sources.hasOwnProperty(i)) { \
                        if (sources[i] === 'tagged' || sources[i] === 'event') { \
                            return true; \
                        } \
                    } \
                } \
                return false; \
            } \
            if (this.type === 'facebook') { \
                return trusted(this.sources) || regexMatch(this); \
            } \
            else { \
                return true; \
            } \
        } \
    ";

postSchema.statics.PUBLIC_FIELDS = {
    'type': true,
    'foreign_id': true,
    'foreign_timestamp': true,
    'data': true,
    'facebook_event_id': true
};

postSchema.statics.FACEBOOK_ID_REGEXP = /(\d+)_(\d+)/;

postSchema.methods.fetchFacebookEvent = function (cb) {
    var post = this;

    if (post.data.type !== 'link' || (post.data.link && !FacebookEvent.LINK_REGEXP.test(post.data.link))) {
        // Not a link to a Facebook event
        cb(null, null);
        return;
    }

    var post_match = Post.FACEBOOK_ID_REGEXP.exec(post.foreign_id);
    if (post_match) {
        var post_id = post_match[2];
    }
    else {
        cb("Facebook post ID does not match regex: " + post.foreign_id);
        return;
    }

    facebook.request(post_id, null, function (err, body) {
        if (err) {
            cb(err);
            return;
        }

        // To allow for possible Facebook link in existing post data
        body.link = body.link || post.data.link;

        if (!body.link) {
            // Facebook does not like links to events and link is sometimes missing even when requesting post directly
            // Let's try to find it manually in the message
            // This could introduce some errors if message content was changed to some other event link after the
            // initial event link was set on the post
            var link_search = FacebookEvent.URL_REGEXP.exec(body.message);
            if (!link_search) {
                cb("Facebook post (" + post.foreign_id + ") is missing link: " + util.inspect(body));
                return;
            }

            // We patch-up missing link from what we found in the message
            body.link = link_search[1] + '/';
        }

        var link_match = FacebookEvent.LINK_REGEXP.exec(body.link);
        if (!link_match) {
            cb("Facebook post (" + post.foreign_id + ") has invalid event link: " + util.inspect(body));
            return;
        }

        var event_id = link_match[1];
        var event_link = body.link;

        if (event_link.substring(0, 4) !== 'http') {
            event_link = 'https://www.facebook.com' + event_link;
        }

        facebook.request(event_id + '?fields=id,owner,name,description,start_time,end_time,timezone,is_date_only,location,venue,privacy,updated_time,picture', null, function (err, body) {
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

            facebook.request(event_id + '/invited?summary=1', 0, function (err, body) {
                if (err) {
                    cb(err);
                    return;
                }

                event.invited_summary = body.summary;
                event.invited = body.data;

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

                            // TODO: Do we really want to return all data?
                            cb(null, _.pick(facebook_event, 'event_id', 'data', 'invited_summary', 'fetch_timestamp'));
                        });
                    });
                });
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
        if (callback_post.data.type === 'link' && (!callback_post.data.link || FacebookEvent.LINK_REGEXP.test(callback_post.data.link))) {
            // We fetch Facebook event for the first time or update existing (if multiple posts link to the same event, for example)
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

// If existing, "facebook_event_id" is left and should be exchanged for real data ("facebook_event") or deleted
postSchema.statics.cleanPost = function (post) {
    post.fetch_timestamp = post._id.getTimestamp();
    delete post._id;

    // Don't expose some Facebook fields
    if (post.data && post.data.likes && post.data.likes.data) {
        delete post.data.likes.data;
    }
    if (post.data && post.data.comments && post.data.comments.data) {
        delete post.data.comments.data;
    }
    if (post.data && post.data.shares && post.data.shares.data) {
        delete post.data.shares.data;
    }

    if (!post.facebook_event_id) {
        // If false, null, or non-existent, we remove it (so that it is not available in tweets, for example
        delete post.facebook_event_id;
    }

    return post;
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

facebookEventSchema.statics.URL_REGEXP = /facebook\.com(\/events\/\d+)/i; // Case-insensitive because domain name can be case insensitive

facebookEventSchema.statics.LINK_REGEXP = /^\/events\/(\d+)\/$/;

facebookEventSchema.methods.postFetch = function (cb) {
    var event = this;

    Post.find(_.extend({}, {'type': 'facebook', 'foreign_id': {'$in': event.posts}}, settings.POSTS_FILTER)).exec(function (err, posts) {
        if (err) {
            cb(err);
            return;
        }

        event.recursive = _.some(posts, function (post) {
            // Whether we got it from "tagged" source or we have a tag in the message
            return _.indexOf(post.sources, 'tagged') !== -1 || _.some(post.data.message_tags || {}, function (tags) {
                return _.some(tags, function (tag) {
                    return tag.id === settings.FACEBOOK_PAGE_ID;
                });
            });
        });

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

        // "merged_from" and "sources" are from some reason always returned, probably because they are lists
        obj = _.omit(obj.toObject() || {}, 'merged_from', 'sources');

        if (_.isEmpty(obj)) {
            // Post was not already stored
            // We load post manually, because to know if post was stored or not we
            // do not set "new" parameter of findOneAndUpdate call
            // We also want just some fields and a lean object
            Post.findOne(_.extend({}, {'$where': Post.NOT_FILTERED}, settings.POSTS_FILTER, query), Post.PUBLIC_FIELDS).lean(true).exec(function (err, post) {
                if (err) {
                    cb("Post (" + Post.createTypeForeignId(type, foreign_id) + ") load error: " + err);
                    return;
                }

                if (!post) {
                    // Filtered out
                    cb(null, null);
                    return;
                }

                post = Post.cleanPost(post);

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

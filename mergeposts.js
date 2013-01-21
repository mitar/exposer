var async = require('async');
var moment = require('moment');

var _ = require('underscore');

var models = require('./models');
var settings = require('./settings');

var POST_EQUALITY_FIELDS = {};
_.each(models.Post.EQUALITY_FIELDS, function (value, field, list) {
    POST_EQUALITY_FIELDS[field.replace('.', '_')] = '$' + field;
});

function compare(a, b) {
    // We prefer more public posts
    if (a.data.actions && !b.data.actions) {
        return -1;
    }
    else if (!a.data.actions && b.data.actions) {
        return 1;
    }
    // We prefer posts with more likes
    else if (a.data.likes && !b.data.likes) {
        return -1;
    }
    else if (!a.data.likes && b.data.likes) {
        return 1;
    }
    else if (a.data.likes && _.isFinite(a.data.likes.count) && b.data.likes && _.isFinite(b.data.likes.count)) {
        return b.data.likes.count - a.data.likes.count;
    }
    // We prefer posts with more comments
    else if (a.data.comments && !b.data.comments) {
        return -1;
    }
    else if (!a.data.comments && b.data.comments) {
        return 1;
    }
    else if (a.data.comments && _.isFinite(a.data.comments.count) && b.data.comments && _.isFinite(b.data.comments.count)) {
        return b.data.comments.count - a.data.comments.count;
    }
    // We prefer posts which have story
    if (a.data.story && !b.data.story) {
        return -1;
    }
    else if (!a.data.story && b.data.story) {
        return 1;
    }
    // We prefer bigger posts
    var size = _.size(b) - _.size(a);
    if (size !== 0) {
        return size;
    }
    // We prefer older (original, first) posts
    var created_a = moment(a.data.created_time);
    var created_b = moment(b.data.created_time);
    if (created_a < created_b) {
        return -1;
    }
    else if (created_b < created_a) {
        return 1;
    }
    // We prefer posts which were updated recently
    var updated_a = moment(a.data.updated_time);
    var updated_b = moment(b.data.updated_time);
    if (updated_a < updated_b) {
        return 1;
    }
    else if (updated_b < created_a) {
        return -1;
    }
    return 0;
}

function mergeposts() {
    models.Post.aggregate([
        {'$match': {'type': 'facebook'}},
        {'$group': {'_id': POST_EQUALITY_FIELDS, 'count': {'$sum': 1}, 'posts': {'$push': {'foreign_id': '$foreign_id', 'data': '$data', 'sources': '$sources', 'merged_from': '$merged_from'}}}},
        {'$match': {'count': {'$gt': 1}}}
    ], function (err, results) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        async.forEach(results, function (result, cb) {
            var posts = result.posts.sort(compare);

            var first_id = _.first(posts).foreign_id;

            var rest = _.rest(posts);
            var rest_ids = _.pluck(rest, 'foreign_id');

            models.Post.update({'foreign_id': first_id}, {'$addToSet': {'merged_from': rest_ids}, '$unset': {'merged_to': true}}, {'multi': true}, function (err, numberAffected, rawResponse) {
                if (err) {
                    console.error(err);
                }
                else if (numberAffected !== 1) {
                    console.error("Invalid number of Facebook posts set as main: %s", numberAffected, first_id, rawResponse);
                }
                else {
                    models.Post.update({'foreign_id': {'$in': rest_ids}}, {'$set': {'merged_to': first_id}, '$unset': {'merged_from': true}}, {'multi': true}, function (err, numberAffected, rawResponse) {
                        if (err) {
                            console.error(err);
                        }
                        else if (numberAffected !== rest_ids.length) {
                            console.error("Invalid number of Facebook posts set as merged: %s/%s", numberAffected, rest_ids.length, first_id, rest_ids, rawResponse);
                        }
                        else {
                            console.log("Merged Facebook posts: %s -> %s", rest_ids, first_id);
                        }

                        // We handle error independently
                        cb(null);
                    });
                }
            });
        }, function (err) {
            process.exit(0);
        });
    });
}

mergeposts();

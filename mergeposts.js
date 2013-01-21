var async = require('async');

var _ = require('underscore');

var models = require('./models');
var settings = require('./settings');

var EQUALITY_POST_FIELDS = ['from', 'to', 'message', 'message_tags', 'type', 'link', 'name', 'caption', 'picture', 'description', 'story', 'story_tags'];

var EQUALITY_POST_FIELDS_GROUP = {};
_.each(EQUALITY_POST_FIELDS, function (field, i, list) {
    EQUALITY_POST_FIELDS_GROUP[field] = '$data.' + field;
});

function combineposts(posts) {
    if (posts.length === 0) {
        return [];
    }
    else if (posts.length === 1) {
        return [posts];
    }

    var first = _.first(posts);
    var rest = _.rest(posts);

    var same = [first];
    var others = [];
    var f = _.pick(first, EQUALITY_POST_FIELDS);

    _.each(rest, function (post, i, list) {
        var p = _.pick(post, EQUALITY_POST_FIELDS);
        if (_.isEqual(f, p)) {
            same.push(post);
        }
        else {
            others.push(post);
        }
    });

    return [same].concat(combineposts(others));
}

function mergeposts() {
    models.Post.aggregate([
        {'$match': {'type': 'facebook', 'merged_to': null}},
        {'$group': {'_id': EQUALITY_POST_FIELDS_GROUP, 'count': {'$sum': 1}, 'posts': {'$push': '$data'}}},
        {'$match': {'count': {'$gt': 1}}}
    ], function (err, results) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        async.forEach(results, function (result, cb) {
            var posts = _.filter(combineposts(result.posts), function (combined) {
                return combined.length > 1;
            });

            if (posts.length === 0) {
                cb(null);
                return;
            }

            console.log(posts.length);
            var util = require('util');
            console.log(util.inspect(posts, false, 10));
            console.log();
            cb(null);
        }, function (err) {
            process.exit(0);
        });
    });
}

mergeposts();

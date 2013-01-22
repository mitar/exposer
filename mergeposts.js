var async = require('async');

var _ = require('underscore');

var models = require('./models');

var POST_EQUALITY_FIELDS = {};
_.each(models.Post.EQUALITY_FIELDS, function (value, field, list) {
    POST_EQUALITY_FIELDS[field.replace('.', '_')] = '$' + field;
});

function mergeposts() {
    models.Post.aggregate([
        {'$match': {'type': 'facebook'}},
        {'$group': {'_id': POST_EQUALITY_FIELDS, 'count': {'$sum': 1}, 'posts': {'$push': {'foreign_id': '$foreign_id', 'data': '$data'}}}},
        {'$match': {'count': {'$gt': 1}}}
    ], function (err, results) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        async.forEach(results, function (result, cb) {
            models.Post.doMerge(result.posts, function (err, first_id, rest_ids) {
                if (err) {
                    console.log(err);
                }
                else {
                    console.log("Merged Facebook posts: %s -> %s", rest_ids, first_id);
                }
                // We handle error independently
                cb(null);
            });
        }, function (err) {
            process.exit(0);
        });
    });
}

mergeposts();

var async = require('async');
var assert = require('assert');

var _ = require('underscore');

var models = require('./models');

function mergeposts() {
    var processed_ids_set = {};
    var processed_ids_list = [];

    models.Post.find({'type': 'facebook'}, models.Post.PUBLIC_FIELDS).lean(true).exec(function (err, posts) {
        if (err) {
            console.error(err);
            process.exit(1);
            return;
        }

        // In series, otherwise we could have some funny race conditions (we have them anyway, but to a lesser extent)
        async.forEachSeries(posts, function (post, cb) {
            if (processed_ids_set[post.foreign_id]) {
                cb(null);
                return;
            }

            post = models.Post.cleanPost(post);

            models.Post.merge(post, function (err, post_merged, first_id, rest_ids) {
                if (err) {
                    console.log("Error while merging post (%s): %s", post.foreign_id, err);
                    cb(null);
                }
                else if (first_id && rest_ids) {
                    assert(!processed_ids_set[first_id]);

                    processed_ids_set[first_id] = true;
                    processed_ids_list.push(first_id);
                    _.each(rest_ids, function (id, i, list) {
                        assert(!processed_ids_set[id]);

                        processed_ids_set[id] = true;
                        processed_ids_list.push(id);
                    });

                    console.log("Merged Facebook posts: %s -> %s", rest_ids, first_id);
                    cb(null);
                }
                else {
                    models.Post.update({'type': 'facebook', 'foreign_id': post.foreign_id}, {'$unset': {'merged_to': true, 'merged_from': true}}, function (err, numberAffected, rawResponse) {
                        if (err) {
                            console.error("Error while setting post as not merged (%s): %s", post.foreign_id, err);
                        }
                        else if (numberAffected !== 1) {
                            console.error("Invalid number of Facebook posts set as not merged (" + post.foreign_id + ", " + numberAffected + "): " + rawResponse);
                        }
                        // We handle error independently
                        cb(null);
                    });
                }
            }, processed_ids_list);
        }, function (err) {
            process.exit(0);
        });
    });
}

mergeposts();

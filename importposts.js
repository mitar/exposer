var mongodb = require('mongodb');

var models = require('./models');

var mongoUrl = process.argv[2] || null;

if (!mongoUrl) {
    console.error("MongoDB URL program argument for database to import is required");
    process.exit(1);
}

function importposts() {
    mongodb.connect(mongoUrl, function (err, connection) {
        if (err) {
            console.error("MongoDB import connection error: %s", err);
            process.exit(1);
            return;
        }

        console.log("MongoDB import connection successful");

        connection.collection('posts', function(err, collection) {
            if (err) {
                console.error(err);
                process.exit(1);
                return;
            }

            var cursor = collection.find({});
            var count_twitter = 0;
            var count_twitter_all = 0;
            var count_facebook = 0;
            var count_facebook_all = 0;

            function processOne() {
                cursor.nextObject(function(err, post) {
                    if (err){
                        console.error(err);
                        process.exit(1);
                        return;
                    }

                    if (!post) {
                        console.log("%s/%s posts imported, %s/%s Twitter, %s/%s Facebook", (count_twitter + count_facebook), (count_twitter_all + count_facebook_all), count_twitter, count_twitter_all, count_facebook, count_facebook_all);
                        process.exit(0);
                        return;
                    }

                    if (post.type === 'twitter') {
                        models.Post.storeTweet(post.original_data, post.sources || [], function (err, tweet) {
                            if (err) {
                                console.error(err);
                                process.exit(1);
                                return;
                            }

                            if (tweet) {
                                console.log("Imported tweet: %s", tweet.foreign_id);
                                count_twitter++;
                            }
                            count_twitter_all++;

                            processOne();
                        });
                    }
                    else if (post.type === 'facebook') {
                        models.Post.storeFacebookPost(post.data, post.sources || [], function (err, post) {
                            if (err) {
                                console.error(err);
                                process.exit(1);
                                return;
                            }

                            if (post) {
                                console.log("Imported Facebook post: %s", post.foreign_id);
                                count_facebook++;
                            }
                            count_facebook_all++;

                            processOne();
                        });
                    }
                    else {
                        console.error("Unknown post type: %s", post.type);
                        process.exit(1);
                    }
                });
            }

            processOne();
        });
    });
}

importposts();

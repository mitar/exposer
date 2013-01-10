var shoe = require('shoe');
var dnode = require('dnode');
var swig = require('swig/lib/swig');

var templates = {
    'twitter': require('./templates/posts/twitter.html'),
    'facebook': require('./templates/posts/facebook.html')
};

var $ = require('jquery-browserify');

var FACEBOOK_POST_REGEXP = /(\d+)_(\d+)/;

var postsCount = 0;
var displayedPosts = {};

function createPost(post) {
    switch (post.type) {
        case 'twitter':
            return templates.twitter({
                'post': post
            });
        case 'facebook':
            var post_link = null;
            if (post.data.actions && post.data.actions.length > 0 && post.data.actions[0].link) {
                post_link = post.data.actions[0].link.split('http://').join('https://');
            }
            else {
                var post_match = FACEBOOK_POST_REGEXP.exec(post.data.id);
                if (post_match) {
                    post_link = 'https://www.facebook.com/' + post_match[1] + '/posts/' + post_match[2];
                }
                else {
                    console.warning("Facebook post does not have a link: %s", post.foreign_id, post)
                }
            }

            return templates.facebook({
                'post': post,
                'post_link': post_link
            });
        default:
            console.error("Unknown post type: %s", post.type, post);
            return null;
    }
}

function renderTweets() {
    if (typeof twttr === 'undefined') {
        alert("Not all necessary scripts have loaded. Are you using ad-block or something similar?");
        return;
    }

    twttr.widgets.load();
}

function displayNewPost(post) {
    if (displayedPosts[post.type + '-' + post.foreign_id]) {
        return;
    }
    displayedPosts[post.type + '-' + post.foreign_id] = true;
    postsCount++;

    var t = createPost(post);
    if (t) {
        $(t).prependTo('#posts');
        renderTweets();
    }
}

function displayOldPosts(posts) {
    $.each(posts, function (i, post) {
        if (displayedPosts[post.type + '-' + post.foreign_id]) {
            return;
        }
        displayedPosts[post.type + '-' + post.foreign_id] = true;
        postsCount++;

        var t = createPost(post);
        if (t) {
            $(t).appendTo('#posts');
        }
    });

    renderTweets();
}

$(document).ready(function () {
    var stream = shoe('/dnode');

    var d = dnode({
        'newPost': function (post) {
            displayNewPost(post);
        }
    });
    d.on('remote', function (remote) {
        remote.getPosts(0, 10, function (err, posts) {
            if (err) {
                console.error(err);
                return;
            }

            displayOldPosts(posts);
        });

        $(window).scroll(function (event) {
            if (document.body.scrollHeight - $(this).scrollTop() <= $(this).height()) {
                // Make sure initial posts have been already loaded
                if (postsCount > 0) {
                    // We can use simple counter because we are not deleting any posts
                    // Otherwise, if we would be deleting posts, simply counting could make us skip some posts
                    remote.getPosts(postsCount, 10, function (err, posts) {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        displayOldPosts(posts);
                    });
                }
            }
        });
    }).on('end', function () {
        // TODO: Handle better?
        alert("Connection to the server failed. Please reload to continue with real-time updates.");
    }).pipe(stream).pipe(d);
});

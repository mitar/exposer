var shoe = require('shoe');
var dnode = require('dnode');

var $ = require('jquery-browserify');

var postsCount = 0;
var displayedPosts = {};

function createPost(post) {
    switch (post.type) {
        case 'twitter':
            var t = $('<blockquote/>').addClass('twitter-tweet').append(
                $('<p/>').text(post.data.text)
            ).append(
                $('<a/>').attr('href', 'https://twitter.com/' + post.data.from_user + '/status/' + post.foreign_id).attr('data-datetime', post.foreign_timestamp)
            );

            if (post.data.in_reply_to_status_id) {
                t.attr('data-in-reply-to', post.data.in_reply_to_status_id);
            }

            return $('<div/>').addClass('post').append(t);
        case 'facebook':
            var t = $('<blockquote/>').append(
                $('<p/>').text('Facebook post')
            ).append(
                $('<p/>').text(post.data.message)
            ).append(
                $('<p/>').text('From: ').append(
                    $('<a/>').attr('href', 'https://www.facebook.com/' + post.data.from.id).text(post.data.from.name)
                )
            );

            return $('<div/>').addClass('post').append(
                $('<div/>').addClass('facebook-post').append(
                    $('<div/>').addClass('twt-border').append(t)
                )
            );
        default:
            console.error("Unknown post type: %s", post.type, post);
            return null;
    }
}

function displayNewPost(post) {
    if (displayedPosts[post.type + '-' + post.foreign_id]) {
        return;
    }
    displayedPosts[post.type + '-' + post.foreign_id] = true;
    postsCount++;

    var t = createPost(post);
    if (t) {
        t.prependTo('#posts');
        twttr.widgets.load();
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
            t.appendTo('#posts');
        }
    });

    twttr.widgets.load();
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

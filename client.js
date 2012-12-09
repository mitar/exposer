var shoe = require('shoe');
var dnode = require('dnode');

var $ = require('jquery-browserify');

var displayedPosts = {};

function createPost(post) {
    if (post.type === 'twitter') {
        var t = $('<blockquote/>').addClass('twitter-tweet').append(
            $('<p/>').text(post.data.text)
        ).append(
            $('<a/>').attr('href', 'https://twitter.com/' + post.data.from_user + '/status/' + post.foreign_id).attr('data-datetime', post.foreign_timestamp)
        );

        if (post.data.in_reply_to_status_id) {
            t.attr('data-in-reply-to', post.data.in_reply_to_status_id);
        }

        return $('<div/>').addClass('post').append(t);
    }
    else {
        console.error("Unknown post type: %s", post.type, post);
        return null;
    }
}

function displayNewPost(post) {
    if (displayedPosts[post.type + '-' + post.foreign_id]) {
        return;
    }

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
        remote.getPosts(null, 10, function (err, posts) {
            if (err) {
                console.error(err);
                return;
            }

            displayOldPosts(posts);
        });
    }).on('end', function () {
        // TODO: Handle better?
        alert("Connection to server failed. Please reload to continue with real-time updates.");
    }).pipe(stream).pipe(d);
});

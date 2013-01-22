var dnode = require('dnode');
var moment = require('moment');
var shoe = require('shoe');
var swig = require('swig/lib/swig');

var templates = {
    'twitter': require('./templates/posts/twitter.html'),
    'facebook': require('./templates/posts/facebook.html')
};

var $ = require('jquery-browserify');

var FACEBOOK_ID_REGEXP = /^(\d+)_(\d+)$/;
var DOTS = /\.\.\.$/;

var displayedPosts = {};
var oldestDisplayedPostsDate = null;
var oldestDisplayedPostsIds = {};

function createPost(post) {
    switch (post.type) {
        case 'twitter':
            return $(templates.twitter({
                'post': post
            })).data('foreign_timestamp', post.foreign_timestamp);
        case 'facebook':
            var post_id = null;
            var post_link = null;
            var post_match = FACEBOOK_ID_REGEXP.exec(post.data.id);
            if (post_match) {
                post_id = post_match[2];
                post_link = 'https://www.facebook.com/' + post_match[1] + '/posts/' + post_match[2];
            }
            else if (post.data.from && post.data.from.id) {
                post_link = 'https://www.facebook.com/' + post.data.from.id + '/posts/' + post.data.id;
            }
            else {
                console.warn("Facebook post does not have a link and ID: %s", post.foreign_id, post);
            }

            // Override with a better version
            if (post.data.actions && post.data.actions.length > 0 && post.data.actions[0].link) {
                post_link = post.data.actions[0].link.split('http://').join('https://');
            }

            if (post.data.actions) {
                $.each(post.data.actions, function (i, action) {
                    post.data.actions[action.name.toLowerCase()] = action;
                });
            }

            var event_in_past = false;
            if (post.facebook_event && post.facebook_event.start_time) {
                if (moment(post.facebook_event.start_time) < moment()) {
                    event_in_past = true;
                }
            }

            return $(templates.facebook({
                'post': post,
                'post_link': post_link,
                'post_id': post_id,
                'event_in_past': event_in_past
            })).data('foreign_timestamp', post.foreign_timestamp);
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

function postsRelayout() {
    $('#posts').isotope('reLayout');
}

function shortenPosts() {
    $('#posts .short').dotdotdot({
        'callback': function(isTruncated, orgContent) {
            var t = $(this);
            t.removeClass('short');
            if (isTruncated) {
                var link = $('<span/>').addClass('see-more');
                if (DOTS.test($.trim(t.text()))) {
                    link.append($('<br/>'));
                }
                link.append(
                    $('<a/>').text("See More").click(function (event) {
                        t.trigger('destroy').html(orgContent);
                        postsRelayout();
                    })
                );
                t.append(link);
                postsRelayout();
            }
        }
    });
}

function displayNewPost(post) {
    displayOldPosts([post]);
}

function displayOldPosts(posts) {
    var postElements = $();
    $.each(posts, function (i, post) {
        var id = post.type + '/' + post.foreign_id;

        if (displayedPosts[id]) {
            return;
        }
        displayedPosts[id] = true;

        var newPostDate = moment(post.foreign_timestamp);
        if (!oldestDisplayedPostsDate || newPostDate < oldestDisplayedPostsDate) {
            oldestDisplayedPostsDate = newPostDate;
            oldestDisplayedPostsIds = {};
            oldestDisplayedPostsIds[id] = true;
        }
        else if (newPostDate === oldestDisplayedPostsDate) {
            oldestDisplayedPostsIds[id] = true;
        }

        postElements = postElements.add(createPost(post));
    });

    if (postElements.length > 0) {
        $('#posts').isotope('insert', postElements, function () {
            renderTweets();
            shortenPosts();

            // Twitter and Facebook posts can resize after loading
            // because images and other media can be loaded, so we
            // wait a bit and relayout posts again
            // TODO: Should call this probably after all DOM manipulations and media has loaded - is there such an event?
            setTimeout(postsRelayout, 1000);
            setTimeout(postsRelayout, 5000);
            setTimeout(postsRelayout, 30000);
            setTimeout(postsRelayout, 60000);
        });
    }
}

function objectKeys(obj) {
    var keys = [];
    $.each(obj, function (key, value) {
        keys.push(key);
    });
    return keys;
}

function loadMorePosts(remote) {
    remote.getPosts(oldestDisplayedPostsDate ? oldestDisplayedPostsDate.toDate() : null, objectKeys(oldestDisplayedPostsIds), 10, function (err, posts) {
        if (err) {
            console.error(err);
            return;
        }

        displayOldPosts(posts);
    });
}

function displayNewEvent(event) {
    // TOOD: Implement
    console.log(event);
}

$(document).ready(function () {
    $('#posts').isotope({
        'itemSelector': '.post',
        'getSortData': {
            'foreign_timestamp': function (elem) {
                return moment(elem.data('foreign_timestamp')).valueOf();
            }
        },
        'sortBy': 'foreign_timestamp',
        'sortAscending': false,
        // We disable animations
        'transformsEnabled': false,
        'animationEngine': 'css'
    });

    var stream = shoe('/dnode');

    var d = dnode({
        'newPost': function (post) {
            displayNewPost(post);
        },
        'newEvent': function (event) {
            displayNewEvent(event);
        }
    });
    d.on('remote', function (remote) {
        loadMorePosts(remote);

        $('#load-posts').click(function (event) {
            loadMorePosts(remote);
        }).show();

        $(window).scroll(function (event) {
            // Two screens before the end we start loading more posts
            if (document.body.scrollHeight - $(this).scrollTop() <= 3 * $(this).height()) {
                // Make sure initial posts have been already loaded
                if (!$.isEmptyObject(displayedPosts)) {
                    loadMorePosts(remote);
                }
            }
        });
    }).on('end', function () {
        // TODO: Handle better?
        alert("Connection to the server failed. Please reload to continue with real-time updates.");
    }).pipe(stream).pipe(d);
});

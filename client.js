var dnode = require('dnode');
var moment = require('moment');
var shoe = require('shoe');
var swig = require('swig/lib/swig');

swig.init({
    'filters': require('./filters')
});

// So that including works
require('./templates/event_include.html')(swig);

var templates = {
    'twitter': require('./templates/posts/twitter.html')(swig),
    'facebook': require('./templates/posts/facebook.html')(swig),
    'event': require('./templates/event.html')(swig)
};

var $ = require('jquery-browserify');

var FACEBOOK_ID_REGEXP = /^(\d+)_(\d+)$/;
var DOTS = /\.\.\.$/;
var MAX_RECONNECT_INTERVAL = 5 * 60 * 1000; // ms

var SECTIONS = {
    'stream': true,
    'events': true,
    'links': true,
    'stats': true
};

var remotePromise = null;
remote = null;
var i18nPromise = null;

var displayedPosts = {};
var oldestDisplayedPostsDate = null;
var oldestDisplayedPostsIds = {};
var graph = null;
var calendar = null;
var knownEvents = {};
var postsRelayout = null;

function createPost(post) {
    switch (post.type) {
        case 'twitter':
            return $(templates.twitter({
                'post': post
            })).data('post', post);
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

            var like_link = null;
            if (post.facebook_event) {
                like_link = post.facebook_event.data.link;
            }
            else if (post.data.link) {
                like_link = post.data.link;
            }
            else if (post.data.actions.like) {
                like_link = post.data.actions.like.link;
            }
            else {
                like_link = post_link;
            }

            return $(templates.facebook({
                'post': post,
                'post_link': post_link,
                'post_id': post_id,
                'event': post.facebook_event,
                'event_in_past': event_in_past,
                'like_link': like_link
            })).data('post', post);
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

    // Twitter and Facebook posts can resize after loading
    // because images and other media can be loaded, so we
    // wait a bit and relayout posts again
    // TODO: Should call this probably after all DOM manipulations and media has loaded - is there such an event?
    setTimeout(postsRelayout, 1000);
    setTimeout(postsRelayout, 5000);
    setTimeout(postsRelayout, 30000);
    setTimeout(postsRelayout, 60000);
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
            shortenPosts();
            renderTweets();
        });
        $.each(postElements, function (i, el) {
            FB.XFBML.parse(el);
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

function loadMorePosts() {
    remotePromise.done(function () {
        remote.getPosts(oldestDisplayedPostsDate ? oldestDisplayedPostsDate.toDate() : null, objectKeys(oldestDisplayedPostsIds), 10, function (err, posts) {
            if (err) {
                console.error(err);
                return;
            }

            displayOldPosts(posts);
        });
    });
}

function displayNewEvent(event) {
    event = prepareEvent(event);
    if (event) {
        $('#calendar').trigger('eventCalendar.add', event);
    }
}

function setActiveSection(section) {
    $('#menu li').removeClass('active');
    $('#menu li.' + section).addClass('active');
    $('.section').removeClass('active');
    $('.section.' + section).addClass('active');

    if (section === 'stream') {
        postsRelayout();
        renderTweets();
    }
    else if (section === 'stats') {
        loadGraph();
    }
    else if (section === 'events') {
        loadEvents();
    }
}

function getSection(li) {
    var section = null;
    $.each($(li).attr('class').split(' '), function (i, cls) {
        if (cls in SECTIONS) {
            section = cls;
            return false;
        }
    });
    return section;
}

function getActiveSection() {
    return getSection($('#menu li.active'));
}

function convertStats(stats) {
    var result = {
        'all': [],
        'twitter': [],
        'facebook': []
    };
    $.each(stats, function (i, s) {
        if (s[1] !== 0) {
            result.all.push([s[0], s[1]]);
        }
        if (s[2] !== 0) {
            result.twitter.push([s[0], s[2]]);
        }
        if (s[3] !== 0) {
            result.facebook.push([s[0], s[3]]);
        }
    });
    return result;
}

function loadGraphData(event) {
    remote.getStats(event.min, event.max, function (err, stats) {
        stats = convertStats(stats);
        graph.series[0].setData(stats.all);
        graph.series[1].setData(stats.twitter);
        graph.series[2].setData(stats.facebook);
    });
}

function loadGraph() {
    if (graph) {
        return;
    }

    remotePromise.done(function () {
        remote.getStats(null, null, function (err, stats) {
            if (err) {
                console.error(err);
                return;
            }

            stats = convertStats(stats);

            graph = new Highcharts.StockChart({
                'chart': {
                    'renderTo': 'graph',
                    'type': 'areaspline',
                    'zoomType': 'x',
                    'borderRadius': 10
                },
                'credits': {
                    'enabled': false
                },
                'navigator': {
                    'adaptToUpdatedData': false,
                    'baseSeries': 0
                },
                'legend': {
                    'enabled': true,
                    'verticalAlign': 'top',
                    'floating': true,
                    'padding': 5
                },
                'rangeSelector': {
                    'buttonTheme': {
                        'width': 50
                    },
                    'buttons': [
                        {
                            'type': 'day',
                            'count': 1,
                            'text': "day"
                        },
                        {
                            'type': 'week',
                            'count': 1,
                            'text': "week"
                        },
                        {
                            'type': 'month',
                            'count': 1,
                            'text': "month"
                        },
                        {
                            'type': 'year',
                            'count': 1,
                            'text': "year"
                        },
                        {
                            'type': 'all',
                            'text': "all"
                        }
                    ],
                    'selected': 4 // All
                },
                'xAxis': {
                    'events': {
                        'afterSetExtremes': loadGraphData
                    },
                    'minRange': 24 * 60 * 60 * 1000 // One day
                },
                'yAxis': {
                    'title': {
                        'text': "Number of posts"
                    },
                    'min': 0
                },
                'plotOptions': {
                    'series': {
                        'marker': {
                            'enabled': true,
                            'radius': 3
                        },
                        'dataGrouping': {
                            'enabled': false
                        }
                    }
                },
                'series': [
                    {
                        'name': "All",
                        'data': stats.all
                    },
                    {
                        'name': "Twitter",
                        'data': stats.twitter
                    },
                    {
                        'name': "Facebook",
                        'data': stats.facebook
                    }
                ]
            });
        });
    });
}

function prepareEvent(event) {
    if (knownEvents[event.event_id]) {
        return null;
    }

    var event_in_past = false;
    if (event.start_time) {
        if (moment(event.start_time) < moment()) {
            event_in_past = true;
        }
    }

    knownEvents[event.event_id] = true;

    return {
        'date': '' + moment(event.data.start_time).valueOf(),
        'url': event.data.link,
        'dom': $(templates.event({
            'event': event,
            'event_in_past': event_in_past
        }))
    }
}

function loadEvents() {
    if (calendar) {
        return;
    }

    remotePromise.done(function () {
        i18nPromise.done(function () {
            remote.getEvents(function (err, events) {
                if (err) {
                    console.error(err);
                    return;
                }

                events = $.map(events, function (event, i) {
                    return prepareEvent(event);
                });

                var options = {
                    'jsonData': events,
                    'eventsLimit': 0,
                    'showDescription': true,
                    'moveSpeed': 0,
                    'moveOpacity': 1.0,
                    'showDayAsWeeks': false,
                    'monthNames': [
                        i18n.t("events.month.january"), i18n.t("events.month.february"), i18n.t("events.month.march"),
                        i18n.t("events.month.april"), i18n.t("events.month.may"), i18n.t("events.month.june"),
                        i18n.t("events.month.july"), i18n.t("events.month.august"), i18n.t("events.month.september"),
                        i18n.t("events.month.october"), i18n.t("events.month.november"), i18n.t("events.month.december")
                    ],
                    'dayNamesShort': [
                        i18n.t("events.week.sunday"), i18n.t("events.week.monday"), i18n.t("events.week.tuesday"),
                        i18n.t("events.week.wednesday"), i18n.t("events.week.thursday"), i18n.t("events.week.friday"),
                        i18n.t("events.week.saturday")
                    ],
                    'txt_noEvents': i18n.t("events.no-events"),
                    'txt_SpecificEvents_prev': i18n.t("events.before-text"),
                    'txt_SpecificEvents_after': i18n.t("events.after-text"),
                    'txt_next': i18n.t("events.next-month"),
                    'txt_prev': i18n.t("events.previous-month"),
                    'txt_NextEvents': i18n.t("events.upcoming-events")
                };

                if (CURRENT_LANGUAGE === 'sl') {
                    options.num_abbrev_str = function (month, num) {
                        return num + ". " + month;
                    }
                }

                calendar = $('#calendar').eventCalendar(options);
            });
        });
    });
}

$(document).ready(function () {
    var remoteDeferred = $.Deferred();
    remotePromise = remoteDeferred.promise();

    postsRelayout = $.debounce(200, function () {
        $('#posts').isotope('reLayout');
    });

    $('#posts').isotope({
        'itemSelector': '.post',
        'getSortData': {
            'foreign_timestamp': function (elem) {
                return moment(elem.data('post').foreign_timestamp).valueOf();
            }
        },
        'sortBy': 'foreign_timestamp',
        'sortAscending': false,
        // We disable animations
        'transformsEnabled': false,
        'animationEngine': 'css'
    });

    $(window).hashchange(function (event, data) {
        var current_hash = data.currentHash;

        if (current_hash) {
            if (current_hash in SECTIONS) {
                setActiveSection(current_hash);
            }
            else {
                $(window).updatehash(getActiveSection());
            }
        }
        else {
            $(window).updatehash(getActiveSection());
        }
    });

    i18nPromise = i18n.init({
        'lng': CURRENT_LANGUAGE,
        // We use session for storing the language preference
        'useCookie': false,
        'languages': LANGUAGES,
        'fallbackLng': LANGUAGES[0],
        'namespaces': ['translation'],
        'resGetPath': 'locales/resources.json?lng=__lng__&ns=__ns__',
        'dynamicLoad': true
    }).promise();

    var last_retry = 100; // ms

    function connect(callback) {
        var stream = shoe((REMOTE || '') + '/dnode');

        var d = dnode({
            'newPost': function (post) {
                displayNewPost(post);
            },
            'newEvent': function (event) {
                displayNewEvent(event);
            }
        });
        d.on('remote', function (r) {
            if (last_retry != 100) {
                console.warn("Connection to the server restored.");

                // Reset back
                last_retry = 100;
            }

            remote = r;
            if (!remoteDeferred.isResolved) {
                remoteDeferred.resolve();
            }

            if (callback) {
                callback();
            }

            $('#load-posts').click(function (event) {
                loadMorePosts();
            }).show();

            $(window).scroll(function (event) {
                // Two screens before the end we start loading more posts
                if (document.body.scrollHeight - $(this).scrollTop() <= 3 * $(this).height()) {
                    // Make sure initial posts have been already loaded
                    if (!$.isEmptyObject(displayedPosts)) {
                        loadMorePosts();
                    }
                }
            });
        }).on('end', function () {
            console.warn("Connection to the server failed. Retrying in " + last_retry + " ms.");
            setTimeout(connect, last_retry);
            last_retry *= 2;
            if (last_retry > MAX_RECONNECT_INTERVAL) {
                last_retry = MAX_RECONNECT_INTERVAL;
            }
        }).pipe(stream).pipe(d);
    }

    connect(function () {
        loadMorePosts();
    });

    FB.init({
        'appId': FACEBOOK_APP_ID,
        'status': true,
        'cookie': true,
        'xfbml': true,
        'channelUrl': '/channel.html'
    });

    // For current and future .share-action elements
    $(document).on('click', '.share-action', function (event) {
        event.preventDefault();

        var href = $(this).attr('href');
        var post = $(this).closest('.post').data('post');

        var request = {
            'method': 'stream.share',
            'display': 'popup'
        };

        if (post.facebook_event) {
            request.u = post.facebook_event.data.link;
        }
        else if (post.data.link) {
            request.u = post.data.link;
        }
        else {
            request.u = href;
        }

        FB.ui(request, function (response) {
            // TODO: Should we send this to the server so that it can fetch it?
            // response['post_id'] contains post ID
        });
    });
});

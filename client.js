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

var $ = require('jquery');

require('./client/jquery.dotdotdot.js');
require('./client/jquery.isotope.js');
require('./client/jquery.hashchange.js');
require('./client/isotope.js');
require('./client/highstock.js');
require('./client/highstock.exporting.js');
require('./client/jquery.timeago.js');
require('./client/jquery.eventcalendar.js');

$.extend(require('./client/jquery.throttle.js').Cowboy);

var render = require('./render')(templates);

var DOTS = /\.\.\.$/;
var MAX_RECONNECT_INTERVAL = 5 * 60 * 1000; // ms
var INITIAL_RECONNECT_INTERVAL = 100; // ms

var SECTIONS = {
    'stream': true,
    'events': true,
    'links': true,
    'stats': true
};

var remotePromise = null;
var i18nPromise = null;

var displayedPosts = {};
var oldestDisplayedPostsDate = null;
var oldestDisplayedPostsIds = {};
var graph = null;
var calendar = null;
var knownEvents = {};
var knownEventsGraphFlags = [];
var postsRelayout = null;
var getPostsRequested = {};

function preparePost(post) {
    var rendered = render.post(post);

    if (!rendered) {
        return null;
    }

    return $(rendered).data('post', post);
}

function addEvent(event) {
    knownEvents[event.event_id] = true;

    knownEventsGraphFlags.push({
        'x': moment.utc(event.data.start_time).valueOf(),
        'title': '' + knownEventsGraphFlags.length,
        'event': event
    });
    // TODO: We could optimize this by simply inserting at the right place to begin with
    knownEventsGraphFlags.sort(function (a, b) {
        return a.x - b.x;
    });
    knownEventsGraphFlags = $.map(knownEventsGraphFlags, function (event, i) {
        event.title = '' + i;
        return event;
    });

    if (graph) {
        // TODO: Could be probably optimized so that event is not even inserted if out of bounds?
        knownEventsGraphFlags = $.grep(knownEventsGraphFlags, function (event, i) {
            return graph.series[0].points[0].x <= event.x && event.x <= graph.series[0].points[graph.series[0].points.length - 1].x;
        });
        knownEventsGraphFlags = $.map(knownEventsGraphFlags, function (event, i) {
            event.title = '' + i;
            return event;
        });
        graph.series[3].setData(knownEventsGraphFlags);
    }
}

function renderTweets() {
    if (!twttr || !twttr.widgets) {
        console.error("Twitter script has not loaded. Tweets are probably not displayed correctly. Are you using ad-block or something similar?");
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
            if (t.is(':visible') || isTruncated) {
                // We remove the class so that the post are not reprocessed again,
                // but only if the post is visible (otherwise truncation might not
                // work correctly) or we know that it is truncated
                t.removeClass('short');
            }
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
    // TODO: Do we want to update stats section, too?
    displayOldPosts([post]);
}

function displayOldPosts(posts) {
    var post_elements = $();
    $.each(posts, function (i, post) {
        var id = post.type + '/' + post.foreign_id;

        if (displayedPosts[id]) {
            return;
        }
        displayedPosts[id] = true;

        var new_post_date = moment(post.foreign_timestamp);
        if (!oldestDisplayedPostsDate || new_post_date < oldestDisplayedPostsDate) {
            oldestDisplayedPostsDate = new_post_date;
            oldestDisplayedPostsIds = {};
            oldestDisplayedPostsIds[id] = true;
        }
        else if (new_post_date === oldestDisplayedPostsDate) {
            oldestDisplayedPostsIds[id] = true;
        }

        post = preparePost(post);
        if (!post) {
            return;
        }

        post_elements = post_elements.add(post);
    });

    if (post_elements.length > 0) {
        $('#posts').isotope('insert', post_elements, function () {
            shortenPosts();
            renderTweets();
        });
        $.each(post_elements, function (i, el) {
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

function loadMorePosts(override) {
    remotePromise.done(function () {
        var remote = this;
        var since = oldestDisplayedPostsDate ? oldestDisplayedPostsDate.toDate() : null;
        var except = objectKeys(oldestDisplayedPostsIds);
        var request = '' + (since ? since.valueOf() : since) + '|' + except;
        if (!getPostsRequested[request] || override) {
            getPostsRequested[request] = true;

            remote.getPosts(since, except, 20, function (err, posts) {
                if (err) {
                    console.error(err);
                    return;
                }
                displayOldPosts(posts);
            });
        }
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
        shortenPosts();
        renderTweets();
    }
    else if (section === 'stats') {
        loadGraph();
    }
    else if (section === 'events') {
        loadEvents(function (err) {
            if (err) {
                console.error(err);
            }
        });
    }

    $(window).resize();
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
    remotePromise.done(function () {
        var remote = this;
        remote.getStats(event.min, event.max, function (err, stats, count_all, count_twitter, count_facebook) {
            stats = convertStats(stats);
            graph.series[0].setData(stats.all);
            graph.series[1].setData(stats.twitter);
            graph.series[2].setData(stats.facebook);

            $('#under-graph').text("Shown interval cumulative: All " + count_all + ", Twitter " + count_twitter + ", Facebook " + count_facebook);
        });
    });
}

function loadGraph() {
    if (graph) {
        return;
    }

    remotePromise.done(function () {
        var remote = this;
        loadEvents(function (err) {
            if (err) {
                console.error(err);
                return;
            }

            remote.getStats(null, null, function (err, stats, count_all, count_twitter, count_facebook) {
                if (err) {
                    console.error(err);
                    return;
                }

                stats = convertStats(stats);

                knownEventsGraphFlags = $.grep(knownEventsGraphFlags, function (p, i) {
                    return stats.all[0][0] <= p.x && p.x <= stats.all[stats.all.length - 1][0];
                });

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
                    'tooltip': {
                        'formatter': function () {
                            if (this.series && this.series.index === 3) {
                                var event = knownEventsGraphFlags[parseInt(this.point.title)].event;
                                return render.event(event);
                            }
                            else {
                                // Copy-paste and adapted from original defaultFormatter

                                var pThis = this;
                                var items = pThis.points || Highcharts.splat(pThis);
                                var series = items[0].series;
                                var s;

                                // Build the header
                                s = [series.tooltipHeaderFormatter(items[0].key)];

                                // Build the values
                                Highcharts.each(items, function (item) {
                                    series = item.series;
                                    s.push(
                                        (series.tooltipFormatter && series.tooltipFormatter(item)) || item.point.tooltipFormatter(series.tooltipOptions.pointFormat)
                                    );
                                });

                                // Footer
                                s.push(series.tooltipOptions.footerFormat || '');

                                return s.join('');
                            }
                        },
                        'useHTML': true
                    },
                    'series': [
                        {
                            'name': "All",
                            'data': stats.all,
                            'id': 'all'
                        },
                        {
                            'name': "Twitter",
                            'data': stats.twitter
                        },
                        {
                            'name': "Facebook",
                            'data': stats.facebook
                        },
                        {
                            'type': 'flags',
                            'data': knownEventsGraphFlags,
                            'shape': 'squarepin',
                            'showInLegend': false
                        }
                    ]
                });

                $('#under-graph').text("Shown interval cumulative: All " + count_all + ", Twitter " + count_twitter + ", Facebook " + count_facebook);

                // To fix slight size mismatch on initial load
                $(window).resize();
            });
        });
    });
}

function prepareEvent(event) {
    if (knownEvents[event.event_id]) {
        return null;
    }
    addEvent(event);

    return {
        'date': '' + moment.utc(event.data.start_time).valueOf(),
        'url': event.data.link,
        'dom': $(render.event(event))
    };
}

function loadEvents(cb) {
    if (calendar) {
        cb(null);
        return;
    }

    remotePromise.done(function () {
        var remote = this;
        i18nPromise.done(function () {
            remote.getEvents(function (err, events) {
                if (err) {
                    cb(err);
                    return;
                }

                if (events.length === 0) {
                    cb(null);
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
                cb(null);
            });
        });
    });
}

$(document).ready(function () {
    var remote_deferred = $.Deferred();
    remotePromise = remote_deferred.promise();

    var reconnect_wait = null;

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
            current_hash = current_hash.substring(1);
            if (current_hash in SECTIONS) {
                setActiveSection(current_hash);
            }
            else {
                $(window).updatehash('!' + getActiveSection());
            }
        }
        else {
            $(window).updatehash('!' + getActiveSection());
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

    var last_retry = INITIAL_RECONNECT_INTERVAL; // ms

    function connect(callback) {
        reconnect_wait = null;

        var stream = shoe((REMOTE || '') + '/dnode');

        var d = dnode({
            'newPost': function (post) {
                displayNewPost(post);
            },
            'newEvent': function (event) {
                displayNewEvent(event);
            }
        });
        d.on('remote', function (remote) {
            if (last_retry != INITIAL_RECONNECT_INTERVAL) {
                console.warn("Connection to the server restored.");

                // Reset back
                last_retry = INITIAL_RECONNECT_INTERVAL;
            }

            if (remote_deferred.state() === 'pending') {
                remote_deferred.resolveWith(remote);
            }

            if (callback) {
                callback();
            }

            $('#load-posts').click(function (event) {
                if (remote_deferred.state() === 'pending' && reconnect_wait !== null) {
                    console.warn("Forcing reconnect to the server.");
                    clearTimeout(reconnect_wait);
                    reconnect_wait = null;
                    last_retry = INITIAL_RECONNECT_INTERVAL;
                    connect();
                }

                loadMorePosts(true);
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
            if (remote_deferred.state() === 'pending') {
                remote_deferred.reject();
            }
            remote_deferred = $.Deferred();
            remotePromise = remote_deferred.promise();

            console.warn("Connection to the server failed. Retrying in " + last_retry + " ms.");
            reconnect_wait = setTimeout(connect, last_retry);
            last_retry *= 2;
            if (last_retry > MAX_RECONNECT_INTERVAL) {
                last_retry = MAX_RECONNECT_INTERVAL;
            }
        }).pipe(stream).pipe(d);
    }

    connect(function () {
        loadMorePosts(true);
    });

    if (FACEBOOK_APP_ID) {
        FB.init({
            'appId': FACEBOOK_APP_ID,
            'status': true,
            'cookie': true,
            'xfbml': true,
            'channelUrl': '/channel.html'
        });
    }

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

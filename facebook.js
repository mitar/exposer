var request = require('request');
var util = require('util');

var _ = require('underscore');

var settings = require('./settings');

var QUERY_STRING_EXIST = /\?/;

exports.request = function (url_orig, limit, cb, payload) {
    var url = url_orig;
    if (url.substring(0, 4) !== 'http') {
        url = 'https://graph.facebook.com/' + url;
    }

    if (QUERY_STRING_EXIST.test(url)) {
        url += '&access_token=' + settings.FACEBOOK_ACCESS_TOKEN;
    }
    else {
        url += '?access_token=' + settings.FACEBOOK_ACCESS_TOKEN;
    }

    if (_.isFinite(limit)) {
        // If limit === 0 we want to fetch multiple pages, everything, so we go for 5000 per page
        url += '&limit=' + (limit || 5000);
    }

    function page(url, cb) {
        request({
            'url': url,
            'method': _.isObject(payload) ? 'POST' : 'GET',
            'form': payload
        }, function (error, res, body) {
            if (error || !res || res.statusCode !== 200) {
                cb("Facebook request (" + url_orig + ") error, error: " + error + ", status: " + (res && res.statusCode) + ", body: " + util.inspect(body));
                return;
            }

            try {
                body = JSON.parse(body);
            }
            catch (e) {
                cb("Facebook request (" + url_orig + ") parse error: " + e);
                return;
            }

            // If limit === 0 we want to fetch multiple pages, everything, so we go for next page, if available
            if (limit === 0 && body.data && body.data.length !== 0 && body.paging && body.paging.next) {
                page(body.paging.next, function (err, next_body) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    // We take only body.data from next pages
                    body.data.push.apply(body.data, next_body.data);

                    cb(null, body);
                });
            }
            else {
                cb(null, body);
            }
        });
    }

    page(url, cb);
};

exports.request.post = function (url, cb, payload) {
    payload = payload || {};
    exports.request(url, null, cb, payload);
};

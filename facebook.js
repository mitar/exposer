var request = require('request');
var util = require('util');

var _ = require('underscore');

var settings = require('./settings');

var QUERY_STRING_EXIST = /\?/;

exports.request = function (url_orig, cb, payload) {
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

        cb(null, body);
    });
};

exports.request.post = function (url, cb, payload) {
    payload = payload || {};
    exports.request(url, cb, payload);
};

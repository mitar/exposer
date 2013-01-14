var request = require('request');

exports.request = function (url, cb) {
    if (url.substring(0, 4) !== 'http') {
        url = 'https://graph.facebook.com/' + url;
    }

    request(url, function (error, res, body) {
        if (error || !res || res.statusCode !== 200) {
            console.error("Facebook request error: %s", url, error, res && res.statusCode, body);
            return;
        }

        try {
            body = JSON.parse(body);
        }
        catch (e) {
            console.error("Facebook request parse error: %s", url, e);
            return;
        }

        cb(body);
    });
};

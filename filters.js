var filters = require('swig/lib/filters');

var NEWLINE = /\n/g;
var FACEBOOK_PHOTO = /_s\.(\S+)$/;

exports.facebook_message = function (input) {
    // TODO: Find links
    return filters.escape(input).replace(NEWLINE, "<br/>");
};

exports.facebook_photo = function (input) {
    return input.replace(FACEBOOK_PHOTO, "_n.$1");
};
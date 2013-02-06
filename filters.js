var filters = require('swig/lib/filters');
var moment = require('moment');

var $ = require('jquery');

var NEWLINE = /\n/g;
var HTTP_LINK = /(https?:\/\/([0-9a-z-]+\.)+[a-z]{2,4}\.?(\/\S*)?)|(www\.([0-9a-z-]+\.)+[a-z]{2,4}(\/\S*)?)|(([0-9a-z-]+\.)+(com|edu|gov|int|mil|net|org)\/\S*)/gi;
var FACEBOOK_PHOTO = /_s\.(\S+)$/;

exports.facebook_text = function (input, input_tags) {
    function non_tags(text) {
        // Links are before newline because otherwise newline does not stop link end search
        return filters.escape(text).replace(HTTP_LINK, '<a href="$&" class="text-link">$&</a>').replace(NEWLINE, '<br/>');
    }

    input_tags = input_tags || {};

    var keys = [];
    $.each(input_tags, function (key, tags) {
        keys.push(key);
    });
    keys.sort();

    var output = '';
    var offset = 0;
    // We have to traverse in key order
    $.each(keys, function (i, key) {
        $.each(input_tags[key], function (j, tag) {
            if (tag.offset >= offset) {
                output += non_tags(input.substring(offset, tag.offset));
                output += '<a href="https://www.facebook.com/' + tag.id + '" class="tag">' + filters.escape(input.substring(tag.offset, tag.offset + tag.length)) + '</a>';
                offset = tag.offset + tag.length;
            }
        });
    });
    output += non_tags(input.substring(offset));
    return output;
};

exports.facebook_photo = function (input) {
    return input.replace(FACEBOOK_PHOTO, '_n.$1');
};

exports.facebook_picture = function (input) {
    if (input.indexOf('safe_image.php') !== -1) {
        return input + '&cfs=1';
    }
    else {
        return input;
    }
};

// TODO: Use moment also to display/format dates, instead of current filters?
exports.fix_date = function (date) {
    return moment(date).toDate();
};

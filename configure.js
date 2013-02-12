var filters = require('swig/lib/filters');
var path = require('path');
var uglify = require('uglify-js');

module.exports = function (bundle) {
    bundle.register('.html', function (body, file) {
        return "module.exports = function (swig) {return swig.compile('" + filters.escape(body, 'js') + "', {'filename': '" + filters.escape(path.relative('./templates/', file), 'js') + "'})};";
    });
    if (process.env.NODE_ENV === 'production') {
        bundle.register('post', function (body) {
            return uglify.minify(body, {
                'fromString': true
            }).code;
        });
    }
    bundle.require('jquery-browserify', {'target': 'jquery' });
};
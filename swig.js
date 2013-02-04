var filters = require('swig/lib/filters');
var path = require('path');

module.exports = function (bundle) {
    bundle.register('.html', function (body, file) {
        return "module.exports = function (swig) {return swig.compile('" + filters.escape(body, 'js') + "', {'filename': '" + filters.escape(path.relative('./templates/', file), 'js') + "'})};";
    });
};
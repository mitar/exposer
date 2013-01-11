var filters = require('swig/lib/filters');

module.exports = function (bundle) {
    bundle.register('.html', function (body, file) {
        return "var swig = require('swig/lib/swig'); swig.init({'filters': require('../../filters')}); module.exports = swig.compile('" + filters.escape(body, 'js') + "', {'filename': '" + filters.escape(file, 'js') + "'});";
    });
};
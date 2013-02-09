var async = require('async');

var models = require('./models');

function ensureindexes() {
    async.forEach([models.Post, models.FacebookEvent], function (model, cb) {
        model.ensureIndexes(function (err) {
            if (err) {
                console.error(err);
            }
            // We handle error independently
            cb(null);
        });
    }, function (err) {
        process.exit(0);
    });
}

models.once('ready', function () {
    ensureindexes();
});

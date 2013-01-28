_ = require('underscore');

exports.REMOTE = !_.isUndefined(process.env.REMOTE) ? process.env.REMOTE : 'https://exposer.herokuapp.com';
exports.PORT = process.env.PORT || '5000';
exports.SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:5000';
exports.MONGODB_URL = process.env.MONGODB_URL || process.env.MONGOHQ_URL || 'mongodb://localhost/exposer';
exports.TWITTER_CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY;
exports.TWITTER_CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET;
exports.TWITTER_ACCESS_TOKEN_KEY = process.env.TWITTER_ACCESS_TOKEN_KEY;
exports.TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;
exports.FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
exports.FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
exports.FACEBOOK_ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
exports.FACEBOOK_REALTIME_VERIFY_TOKEN = process.env.FACEBOOK_REALTIME_VERIFY_TOKEN;
exports.KEEP_ALIVE_INTERVAL = 25 * 60 * 1000; // ms

exports.TARGET_LANGUAGE = 'slovene';
exports.TARGET_LANGUAGE_MAX_RANK = 3;
exports.TWITTER_QUERY = ['#gotofje', '#gotofsi', '#protesti', '@gotofsi', '@gotofje', '#gotoviso', '#mbprotest', '#ljprotest', '#kkprotest', '#ceprotest', '#fertikje', '#demonstracije', '#zbor', '#nisegotovo', '#malomorgen', '#politikasi', '#volitve', '#vstaja', '#zborzarepubliko', '#korupcija', '#jansa', '#jansevanje', '#pahor', '#stavkajs', '#stavka', '#javnisektor', '#onlyinslovenia', '#sviz', '#zombiji'];
exports.FACEBOOK_QUERY = ['gotofje', 'gotofsi', 'protesti', 'gotoviso', 'mbprotest', 'ljprotest', 'kkprotest', 'ceprotest', 'fertikje', 'demonstracije', 'nisegotovo', 'malomorgen', 'politikasi', 'zborzarepubliko', 'jansevanje', 'stavkajs', 'javnisektor', 'onlyinslovenia'];
exports.FACEBOOK_REALTIME_PATHNAME = '/fb/realtime';
exports.MAX_POSTS_PER_REQUEST = 50;
exports.FACEBOOK_POLL_INTERVAL = process.env.FACEBOOK_POLL_INTERVAL || 3 * 60 * 1000; // ms
exports.FACEBOOK_THROTTLE = {
    'requests': 600,
    'interval': 600 * 1000 // ms
};
exports.POSTS_FILTER = {
    'data.from.id': {'$nin': [
        // Henrik Grubelnik (https://www.facebook.com/henrik.grubelnik) overposting
        '100000591290520',
        // Valentino Robboni (https://www.facebook.com/valentino.robboni.1) non-related nudity
        '100004681320686'
    ]},
    // TODO: This probably should not be filtered but just downvoted in advance (when we will have support for that)
    'language': {'$nin': [
        'italian',
        'turkish',
        'latin',
        'spanish',
        'portuguese'
    ]}
};

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

exports.TWITTER_QUERY = ['#gotofje', '#gotofsi', '#protesti', '@gotofsi', '@gotofje', '#gotoviso', '#mbprotest', '#ljprotest', '#fertikje', '#demonstracije'];
exports.FACEBOOK_QUERY = ['gotofje', 'gotofsi', 'protesti', 'gotoviso', 'mbprotest', 'ljprotest', 'fertikje', 'demonstracije'];
exports.FACEBOOK_REALTIME_PATHNAME = '/fb/realtime';
exports.MAX_POSTS_PER_REQUEST = 50;
exports.FACEBOOK_POLL_INTERVAL = 3 * 60 * 1000; // ms
exports.FACEBOOK_INTERVAL_BETWEEN_KEYWORDS = 5 * 1000; // ms (they say that one request per second rate is OK, so we do one every five seconds)
exports.POSTS_FILTER = {
    // Henrik Grubelnik (https://www.facebook.com/henrik.grubelnik) overposting
    'data.from.id': {'$ne': '100000591290520'}
};

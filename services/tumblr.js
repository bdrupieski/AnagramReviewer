var tumblr = require('tumblr.js');
var tumblrConfig = require('../configuration/tumblr.json');

var client = tumblr.createClient({
    credentials: {
        consumer_key: tumblrConfig.consumerkey,
        consumer_secret: tumblrConfig.consumersecret,
        token: tumblrConfig.accesstoken,
        token_secret: tumblrConfig.accesstokensecret
    },
    returnPromises: true,
});

exports.client = client;


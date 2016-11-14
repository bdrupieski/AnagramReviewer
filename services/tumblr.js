const tumblr = require('tumblr.js');
const tumblrConfig = require('../configuration/tumblr.json');

const client = tumblr.createClient({
    credentials: {
        consumer_key: tumblrConfig.consumerkey,
        consumer_secret: tumblrConfig.consumersecret,
        token: tumblrConfig.accesstoken,
        token_secret: tumblrConfig.accesstokensecret
    },
    returnPromises: true,
});

exports.client = client;


var Twitter = require('twitter');
var twitterConfig = require('./../configuration/twitter.json');
var logger = require('winston');

var client = new Twitter({
    consumer_key: twitterConfig.consumerkey,
    consumer_secret: twitterConfig.consumersecret,
    access_token_key: twitterConfig.accesstoken,
    access_token_secret: twitterConfig.accesstokensecret
});

exports.autoRejectableErrors = [
    {code: 179, message: 'Sorry, you are not authorized to see this status.'},
    {code: 144, message: 'No status found with that ID.'},
    {code: 63, message: 'User has been suspended.'}
];

function getTweet(id) {
    return new Promise((resolve, reject) => {
        client.get(`statuses/show/${id}`, {include_entities: false, trim_user: true, include_my_retweet: true},
            function (error, tweet, response) {
                if (tweet.id) {
                    tweet.rateLimitRemaining = response.headers['x-rate-limit-remaining'];
                    if (tweet.rateLimitRemaining < 10) {
                        reject(`Only ${tweet.rateLimitRemaining} calls remain.`)
                    }
                    return resolve(tweet);
                } else if (error) {
                    return reject(error);
                } else {
                    return reject(`unknown error when retrieving ${id}`);
                }
            });
    });
}

exports.getTweets = function(id1, id2) {
    return Promise.all([getTweet(id1), getTweet(id2)]).then(tweets => {
        return {
            tweet1: tweets[0],
            tweet2: tweets[1]
        }
    });
};

exports.retweet = function(id) {
    logger.info(`retweeting ${id}`);
    //throw [exports.autoRejectableErrors[0]];
    return new Promise((resolve, reject) => {
        client.post(`statuses/retweet/${id}`, {trim_user: true},
            function (error, tweet, response) {
                if (tweet.id) {
                    return resolve(tweet);
                } else if (error.length) {
                    var combinedErrors = error.map(x => x.message).join(" ");
                    return reject(combinedErrors);
                } else if (error) {
                    return reject(error);
                } else {
                    return reject(`unknown error when retweeting ${id}`);
                }
            });
    });
};

exports.unretweet = function(id) {
    logger.info(`unretweeting ${id}`);
    return new Promise((resolve, reject) => {
        client.post(`statuses/unretweet/${id}`, {trim_user: true},
            function (error, tweet, response) {
                if (tweet.id) {
                    return resolve(tweet);
                } else if (error.length) {
                    var combinedErrors = error.map(x => x.message).join(" ");
                    return reject(combinedErrors);
                } else if (error) {
                    return reject(error);
                } else {
                    return reject(`unknown error when unretweeting ${id}`);
                }
            });
    });
};

exports.getRateLimits = function(resources) {

    var params = {};
    if (resources) {
        params.resources = resources.join(",");
    }

    return new Promise((resolve, reject) => {
        client.get('application/rate_limit_status', params, function(error, data, response) {
            if (data) {
                return resolve(data);
            } else if (error) {
                var combinedErrors = error.map(x => x.message).join(" ");
                return reject(combinedErrors);
            } else {
                return reject(`unknown error when retrieving rate_limit_status`);
            }
        })
    });
};

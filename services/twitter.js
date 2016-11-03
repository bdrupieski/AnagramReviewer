var Twitter = require('twitter');
var twitterConfig = require('./../configuration/twitter.json');
var logger = require('winston');
var _ = require('lodash');

var client = new Twitter({
    consumer_key: twitterConfig.consumerkey,
    consumer_secret: twitterConfig.consumersecret,
    access_token_key: twitterConfig.accesstoken,
    access_token_secret: twitterConfig.accesstokensecret
});

exports.autoRejectableErrors = [
    {code: 34, message: 'Sorry, that page does not exist.'},
    {code: 63, message: 'User has been suspended.'},
    {code: 136, message: 'You have been blocked from the author of this tweet.'},
    {code: 144, message: 'No status found with that ID.'},
    {code: 179, message: 'Sorry, you are not authorized to see this status.'},
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
                    logger.error(`error while unretweeting ${id}: ${combinedErrors}`);
                    return reject(combinedErrors);
                } else if (error) {
                    return reject(error);
                } else {
                    return reject(`unknown error when unretweeting ${id}`);
                }
            });
    });
};

exports.destroyTweet = function (id) {
    logger.info(`destroying ${id}`);
    return new Promise((resolve, reject) => {
        client.post(`statuses/destroy/${id}`, {trim_user: true},
            function (error, tweet, response) {
                if (tweet.id_str) {
                    return resolve(tweet);
                } else if (error.length) {
                    var combinedErrors = error.map(x => x.message).join(" ");
                    logger.error(`error while destroying ${id}: ${combinedErrors} `);
                    return reject(combinedErrors);
                } else if (error) {
                    return reject(error);
                } else {
                    return reject(`unknown error when destroying ${id}`);
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

exports.oembedTweet = function(tweetId) {
    return new Promise((resolve, reject) => {
        client.get('statuses/oembed', {id: tweetId, hide_thread: true, hide_media: true}, function(error, data, response) {
            if (error && error.length) {
                var combinedErrors = error.map(x => x.message).join(" ");
                return reject(combinedErrors);
            } else if (error) {
                return reject(error);
            } if (data) {
                return resolve(data);
            } else {
                return reject(`unknown error when retrieving rate_limit_status`);
            }
        })
    });
};

exports.getPastTweetsUpTo3200 = function() {

    var getTimelineTweetsGreaterThanMaxId = function(maxId) {

        var data = {
            count: 200,
            trim_user: true,
            exclude_replies: true
        };

        if (maxId) {
            data.max_id = maxId;
        }

        return new Promise((resolve, reject) => {
            client.get('statuses/user_timeline', data, function (error, data, response) {
                if (error) {
                    reject(error);
                }
                else if (data) {
                    return resolve(data);
                } else {
                    return reject(`unknown error when retrieving statuses/user_timeline`);
                }
            })
        });
    };

    var allTweets = [];
    var count = 0;

    function recurse(maxId) {
        var closedMaxId = maxId;
        return getTimelineTweetsGreaterThanMaxId(maxId).then(tweets => {

            count++;
            if (count > 20) {
                throw `recursed too many times on ${closedMaxId}`;
            }

            allTweets.push.apply(allTweets, tweets);

            if (tweets.length == 1) {
                return true;
            } else {
                var maxId = tweets[tweets.length - 1].id_str;
                return recurse(maxId);
            }
        })
    }

    return recurse().then(x => {
        return _.uniqBy(allTweets, x => x.id_str);
    });
};
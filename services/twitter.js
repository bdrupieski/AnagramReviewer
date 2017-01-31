const Twitter = require('twitter');
const twitterConfig = require('./../config.json').twitter;
const logger = require('./logger');
const _ = require('lodash');

const client = new Twitter({
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
exports.rateLimitExceeded = {code: 88, message: 'Rate limit exceeded'};

exports.getTweet = function(id) {
    return new Promise((resolve, reject) => {
        client.get(`statuses/show/${id}`, {include_entities: false, trim_user: true, include_my_retweet: true},
            function (error, tweet, response) {
                if (error) {
                    return reject(error);
                } else if (tweet.id) {
                    tweet.rateLimitRemaining = response.headers['x-rate-limit-remaining'];
                    return resolve(tweet);
                } else {
                    logger.error(response);
                    return reject(`unknown error when retrieving ${id}`);
                }
            });
    });
};

exports.getTweets = function(id1, id2) {
    return Promise.all([exports.getTweet(id1), exports.getTweet(id2)]).then(tweets => {
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
                if (error) {
                    if (error.length) {
                        const combinedErrors = error.map(x => x.message).join(" ");
                        return reject(combinedErrors);
                    } else {
                        return reject(error);
                    }
                } else if (tweet && tweet.id) {
                    return resolve(tweet);
                } else {
                    logger.error(response);
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
                if (error) {
                    if (error.length) {
                        const combinedErrors = error.map(x => x.message).join(" ");
                        logger.error(`error while unretweeting ${id}: ${combinedErrors}`);
                        return reject(combinedErrors);
                    } else {
                        return reject(error);
                    }
                } else if (tweet && tweet.id) {
                    return resolve(tweet);
                } else {
                    logger.error(response);
                    return reject(`unknown error when unretweeting ${id}`);
                }
            });
    });
};

exports.destroyTweet = function (id) {
    logger.info(`destroying tweet ${id}`);
    return new Promise((resolve, reject) => {
        client.post(`statuses/destroy/${id}`, {trim_user: true},
            function (error, tweet, response) {
                if (error) {
                    if (error.length) {
                        const combinedErrors = error.map(x => x.message).join(" ");
                        logger.error(`error while destroying ${id}: ${combinedErrors}`);
                        return reject(combinedErrors);
                    } else {
                        return reject(error);
                    }
                } else if (tweet && tweet.id_str) {
                    return resolve(tweet);
                } else {
                    logger.error(response);
                    return reject(`unknown error when destroying ${id}`);
                }
            });
    });
};

function getRateLimits(resources) {

    const params = {};
    if (resources) {
        params.resources = resources.join(",");
    }

    return new Promise((resolve, reject) => {
        client.get('application/rate_limit_status', params, function (error, data, response) {
            if (data) {
                return resolve(data);
            } else if (error) {
                return reject(error);
            } else {
                logger.error(response);
                return reject(`unknown error when retrieving rate_limit_status`);
            }
        })
    });
}

exports.getShowIdRateLimit = function() {
    return getRateLimits(["statuses"]).then(rateLimits => {
        return rateLimits.resources.statuses['/statuses/show/:id'];
    });
};

exports.getAppAndStatusRateLimits = function() {
    return getRateLimits(["application", "statuses"]);
};

exports.oembedTweet = function(tweetId) {
    return new Promise((resolve, reject) => {
        client.get('statuses/oembed', {id: tweetId, hide_thread: true, hide_media: true}, function(error, data, response) {
            if (error) {
                if (error.length) {
                    const combinedErrors = error.map(x => x.message).join(" ");
                    return reject(combinedErrors);
                } else {
                    return reject(error);
                }
            } if (data) {
                return resolve(data);
            } else {
                logger.error(response);
                return reject(`unknown error when retrieving rate_limit_status`);
            }
        })
    });
};

exports.getMostRecent200TimelineTweets = function() {
    const data = {
        count: 200,
        trim_user: true,
        exclude_replies: true
    };
    return new Promise((resolve, reject) => {
        client.get('statuses/user_timeline', data, function (error, data, response) {
            if (error) {
                reject(error);
            }
            else if (data) {
                return resolve(data);
            } else {
                logger.error(response);
                return reject(`unknown error when retrieving statuses/user_timeline`);
            }
        })
    });
};

exports.getPastTweetsUpTo3200 = function() {

    const getTimelineTweetsGreaterThanMaxId = function(maxId) {

        const data = {
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
                    logger.error(response);
                    return reject(`unknown error when retrieving statuses/user_timeline`);
                }
            })
        });
    };

    const allTweets = [];
    let count = 0;

    function recurse(maxId) {
        const closedMaxId = maxId;
        return getTimelineTweetsGreaterThanMaxId(maxId).then(tweets => {

            count++;
            if (count > 20) {
                throw `recursed too many times on ${closedMaxId}`;
            }

            allTweets.push.apply(allTweets, tweets);

            if (tweets.length == 1) {
                return true;
            } else {
                const maxId = tweets[tweets.length - 1].id_str;
                return recurse(maxId);
            }
        })
    }

    return recurse().then(x => {
        return _.uniqBy(allTweets, x => x.id_str);
    });
};

function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

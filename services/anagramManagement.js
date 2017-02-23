const anagramsDb = require('../db/anagrams');
const twitter = require("../services/twitter");
const logger = require('./logger');
const tumblr = require("../services/tumblr");
const _ = require("lodash");

exports.autoRejectFromTwitterError = function(matchId, error) {
    const codes = error.map(x => x.code);
    const approvalErrorMessages = error.map(x => x.message).join();
    const rejectableCodes = twitter.autoRejectableErrors.map(x => x.code);

    if (_.intersection(codes, rejectableCodes).length > 0) {
        return anagramsDb.rejectMatch(matchId, true).then(x => {
            return {error: approvalErrorMessages, systemResponse: "Auto-rejected.", remove: true};
        }).catch(err => {
            logger.error(err);
            return {error: approvalErrorMessages, systemResponse: "Auto-rejection failed: " + err, recoveryError: true};
        });
    } else {
        logger.error(approvalErrorMessages);
        return {error: approvalErrorMessages};
    }
};

exports.checkExistenceAndAutoRejectIfTweetsDontExist = function(matchId) {
    return anagramsDb.getTweetsForMatch(matchId).then(tweets => {
        return twitter.getTweets(tweets.tweet1.status_id, tweets.tweet2.status_id);
    }).then(x => {
        return true;
    }).catch(error => {
        const approvalError = error.message || error;
        console.log(error);

        if (Array.isArray(error)) {
            return exports.autoRejectFromTwitterError(matchId, error);
        }

        return {error: approvalError};
    });
};

exports.postToTumblr = function(matchId, orderAsShown) {
    return anagramsDb.getTweetsForMatch(matchId).then(tweets => {
        return twitter.getTweets(tweets.tweet1.status_id, tweets.tweet2.status_id);
    }).then(tweets => {

        if (!orderAsShown) {
            const temp = tweets.tweet1;
            tweets.tweet1 = tweets.tweet2;
            tweets.tweet2 = temp;
        }

        return postMatchToTumblr(matchId, tweets.tweet1.id_str, tweets.tweet2.id_str, orderAsShown);
    }).then(x => {
        return {successMessage: "Match contains retweet. Posted to tumblr.", remove: true};
    }).catch(error => {

        if (Array.isArray(error)) {
            return exports.autoRejectFromTwitterError(matchId, error);
        }

        logger.error(error);
        return {error: `error posting ${matchId} to tumblr: ${error}`};
    });
};

function postMatchToTumblr(matchId, t1StatusId, t2StatusId, postedInOrder) {
    return Promise.all([
        twitter.oembedTweet(t1StatusId),
        twitter.oembedTweet(t2StatusId)
    ]).then(oembeds => {

        const t1 = oembeds[0];
        const t2 = oembeds[1];

        const title = `${t1.author_name} vs. ${t2.author_name}`;
        const content = `<div> ${t1.html} ${t2.html} </div>`;

        return tumblr.client.createTextPost("anagrammatweest", { title: title, body: content });
    }).then(tumblrResponse => {
        const tumblrPostId = tumblrResponse.id;
        logger.info(`posted tumblr post id: ${tumblrPostId}`);
        return anagramsDb.updateTumblrPostId(matchId, tumblrPostId, postedInOrder);
    });
}

exports.retweetAndPostToTumblr = function(matchId, orderAsShown) {

    let originalTweets, retweet1, retweet2;

    return anagramsDb.getTweetsForMatch(matchId).then(tweets => {
        return twitter.getTweets(tweets.tweet1.status_id, tweets.tweet2.status_id);
    }).then(tweets => {

        if (!orderAsShown) {
            const temp = tweets.tweet1;
            tweets.tweet1 = tweets.tweet2;
            tweets.tweet2 = temp;
        }

        originalTweets = tweets;
        return twitter.retweet(originalTweets.tweet2.id_str);
    }).then(retweet => {
        retweet1 = retweet;
        return twitter.retweet(originalTweets.tweet1.id_str);
    }).then(retweet => {
        retweet2 = retweet;
        return anagramsDb.updateMatchAsRetweeted(matchId, retweet1.id_str, retweet2.id_str, orderAsShown);
    }).then(x => {
        return postMatchToTumblr(matchId, originalTweets.tweet1.id_str, originalTweets.tweet2.id_str, orderAsShown).then(x => {
            return null;
        }).catch(err => {
            return err;
        });
    }).then(tumblrError => {

        const rateLimitRemaining = Math.min(originalTweets.tweet1.rateLimitRemaining, originalTweets.tweet2.rateLimitRemaining);
        const response = {
            successMessage: `Approved ${matchId}. ${rateLimitRemaining} calls remaining.`,
            remove: true
        };

        if (tumblrError) {
            response.tumblrError = `tumblr error for ${matchId}: ${tumblrError}`;
        }

        return response;
    }).catch(error => {

        const approvalError = error.message || error;
        console.log(error);

        if (Array.isArray(error)) {
            return exports.autoRejectFromTwitterError(matchId, error);
        }

        if (retweet1 || retweet2) {
            return Promise.all([retweet1, retweet2].filter(x => x).map(x => twitter.unretweet(x.id_str))).then(unretweet => {
                return {error: approvalError, systemResponse: "Unretweeted."};
            }).catch(err => {
                logger.error(err);
                return {error: approvalError, systemResponse: "Error unretweeting: " + err, recoveryError: true};
            });
        }

        return {error: approvalError};
    });
};

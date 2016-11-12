const twitter = require('./twitter');
const anagramsDb = require('../db/anagrams');
const logger = require('winston');
const _ = require('lodash');

exports.deleteFromDatabaseTheOldestTweetsThatNoLongerExist = function (numberOfOldestTweetsToCheckAtOnce) {
    logger.info(`starting clean up of ${numberOfOldestTweetsToCheckAtOnce} old tweets.`);

    twitter.getShowIdRateLimit().then(showIdRateLimit => {
        if (showIdRateLimit.remaining <= numberOfOldestTweetsToCheckAtOnce) {
            throw `only ${showIdRateLimit.remaining} remaining for show/:id. cannot check ${numberOfOldestTweetsToCheckAtOnce} tweets.`;
        }
        logger.info(`${showIdRateLimit.remaining} show/:id remaining.`);
        return anagramsDb.getOldestUnreviewedTweets(numberOfOldestTweetsToCheckAtOnce);
    }).then(storedTweets => {
        return Promise.all(storedTweets.map(x => determineIfTweetExists(x.status_id))).then(existences => {
            const tweetsAndExistence = _
                .zipWith(storedTweets, existences, (tweet, exists) => {
                    return {tweet: tweet, exists: exists}
                });

            const existingTweets = tweetsAndExistence.filter(x => x.exists).map(x => x.tweet.id);
            const nonexistingTweets = tweetsAndExistence.filter(x => !x.exists).map(x => x.tweet.id);

            logger.info(`${existingTweets.length} tweets still exist`);
            logger.info(`deleting ${nonexistingTweets.length} non-existent tweets: [ ${nonexistingTweets.join(', ')} ]`);

            return anagramsDb.updateTweetsExistenceChecked(existingTweets).then(x => {
                logger.info(`updated ${x.rowCount} tweets as still existing.`);
                return anagramsDb.deleteMatchesWithTweetIds(nonexistingTweets);
            }).then(x => {
                logger.info(`deleted ${x.rowCount} matches.`);
                return anagramsDb.deleteTweets(nonexistingTweets);
            }).then(x => {
                logger.info(`deleted ${x.rowCount} tweets.`);
            });
        });
    }).then(x => {
        return twitter.getShowIdRateLimit();
    }).then(showIdRateLimit => {
        logger.info(`${showIdRateLimit.remaining} show/:id remaining.`);
    }).catch(error => {
        logger.error(error);
    });
};

function determineIfTweetExists(statusId) {
    return twitter.getTweet(statusId).then(tweet => {
        return true;
    }).catch(error => {
        if (Array.isArray(error)) {
            const codes = error.map(x => x.code);
            const tweetNoLongerVisibleErrors = twitter.autoRejectableErrors.map(x => x.code);
            if (_.intersection(codes, tweetNoLongerVisibleErrors).length > 0) {
                return false;
            }
        }

        throw error;
    });
}

const twitter = require('./twitter');
const anagramsDb = require('../db/anagrams');
const anagramManagement = require('../services/anagramManagement');
const logger = require('winston');
const _ = require('lodash');

exports.deleteFromDatabaseTheOldestTweetsThatNoLongerExist = function (numberOfOldestTweetsToCheckAtOnce) {
    logger.info(`starting clean up of ${numberOfOldestTweetsToCheckAtOnce} old tweets.`);

    twitter.getShowIdRateLimit().then(showIdRateLimit => {
        const numberToCheck = Math.min(showIdRateLimit.remaining, numberOfOldestTweetsToCheckAtOnce);
        const numberOfCallsThatWillBeLeft = showIdRateLimit.remaining - numberToCheck;
        if (numberOfCallsThatWillBeLeft < 15) {
            logger.info(`only ${showIdRateLimit.remaining} left for show/:id. skipping check of ${numberOfOldestTweetsToCheckAtOnce} tweets.`);
        } else {
            logger.info(`${showIdRateLimit.remaining} show/:id remaining. checking ${numberToCheck} tweets.`);
            return anagramsDb.getOldestUnreviewedTweets(numberToCheck).then(storedTweets => {
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
            });
        }
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

exports.retweetOnePendingMatch = function() {
    return anagramsDb.getPendingQueuedMatch().then(queuedMatches => {
        if (queuedMatches.length == 0) {
            console.log("no pending matches to dequeue");
        } else {
            const queuedMatch = queuedMatches[0];
            const queuedMatchId = queuedMatch.match_queue_id;
            const matchId = queuedMatch.match_id;
            const orderAsShown = queuedMatch.order_as_shown;

            return anagramsDb.markAttemptedApprovalForMatch(matchId).then(x => {
                return anagramsDb.getCountOfAnagramMatchesWithTweetInThisMatchAlreadyRetweeted(matchId);
            }).then(count => {
                if (count > 0) {
                    return anagramManagement.postToTumblr(matchId, orderAsShown);
                } else {
                    return anagramManagement.retweetAndPostToTumblr(matchId, orderAsShown);
                }
            }).then(x => {
                if (x.error) {
                    if (isRateLimited(x.error)) {
                        throw x.error;
                    } else {
                        throw x;
                    }
                } else {
                    return anagramsDb.updateQueuedMatchAsPosted(queuedMatchId);
                }
            }).then(x => {
                logger.info(`successfully dequeued and posted ${queuedMatchId} for match ${matchId}`);
            }).catch(error => {
                if (isRateLimited(error)) {
                    console.log(`rate limited when dequeuing ${queuedMatchId} for match ${matchId}`);
                } else {
                    logger.error(error);
                    return anagramsDb.updateQueuedMatchAsError(queuedMatchId, error).then(x => {
                        logger.error(`error when dequeuing ${queuedMatchId} for ${matchId}. changed status to error.`);
                    }).catch(error => {
                        logger.error(`error when updating ${queuedMatchId} for ${matchId} into error status.`);
                        logger.error(error);
                    })
                }
            });
        }
    });
};

function isRateLimited(error) {
    if (Array.isArray(error)) {
        const codes = error.map(x => x.code);
        return codes.includes(twitter.rateLimitExceeded.code);
    } else {
        return false;
    }
}

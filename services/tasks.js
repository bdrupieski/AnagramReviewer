const twitter = require('./twitter');
const anagramsDb = require('../db/anagrams');
const matchQueueDb = require("../db/matchQueue");
const anagramManagement = require('../services/anagramManagement');
const logger = require('./logger');
const _ = require('lodash');

exports.deleteFromDatabaseTheOldestTweetsThatNoLongerExist = function (numberOfOldestTweetsToCheckAtOnce) {
    logger.debug(`starting clean up of ${numberOfOldestTweetsToCheckAtOnce} old tweets.`);

    twitter.getShowIdRateLimit().then(showIdRateLimit => {

        const numberOfMinimumCallsToLeaveLeftover = 10;
        const numberToCheck = determineNumberOfTweetsToCheck(showIdRateLimit.remaining,
            numberOfMinimumCallsToLeaveLeftover, numberOfOldestTweetsToCheckAtOnce);

        if (numberToCheck <= 0) {
            logger.info(`${showIdRateLimit.remaining} remaining for show/:id. skipping check of ${numberOfOldestTweetsToCheckAtOnce} tweets. Would have attempted ${numberToCheck}.`);
        } else {
            logger.info(`${showIdRateLimit.remaining} show/:id remaining. checking ${numberToCheck} tweets.`);
            return anagramsDb.getOldestTweetsNotInMatch(numberToCheck).then(storedTweets => {
                return Promise.all(storedTweets.map(x => determineIfTweetExists(x.status_id))).then(existences => {
                    const tweetsAndExistence = _
                        .zipWith(storedTweets, existences, (tweet, exists) => {
                            return {tweet: tweet, exists: exists}
                        });

                    const existingTweets = tweetsAndExistence.filter(x => x.exists).map(x => x.tweet.id);
                    const nonexistingTweets = tweetsAndExistence.filter(x => !x.exists).map(x => x.tweet.id);

                    logger.info(`${existingTweets.length} tweets still exist. deleting ${nonexistingTweets.length} non-existent tweets: ( ${nonexistingTweets.map(x => `'${x}'`).join(", ")} )`);

                    return anagramsDb.updateTweetsExistenceChecked(existingTweets).then(x => {
                        logger.debug(`updated ${x.rowCount} tweets as still existing.`);
                        return anagramsDb.deleteTweets(nonexistingTweets);
                    }).then(x => {
                        logger.debug(`deleted ${x.rowCount} tweets.`);
                    });
                });
            }).then(x => {
                return twitter.getShowIdRateLimit();
            }).then(showIdRateLimit => {
                logger.debug(`${showIdRateLimit.remaining} show/:id remaining.`);
            });
        }
    }).catch(error => {
        logger.error(error);
    });
};

function determineNumberOfTweetsToCheck(callsRemaining, callsToLeaveAvailable, numToCheck) {
    if (callsRemaining <= callsToLeaveAvailable) {
        return 0;
    } else if (callsRemaining - numToCheck > callsToLeaveAvailable) {
        return numToCheck;
    } else if (callsRemaining - numToCheck <= callsToLeaveAvailable) {
        return callsRemaining - callsToLeaveAvailable;
    }
}

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
    return matchQueueDb.getNextPendingQueuedMatchToDequeue().then(queuedMatches => {
        if (queuedMatches.length == 0) {
            console.log("no pending matches to dequeue");
        } else {
            const queuedMatch = queuedMatches[0];
            const queuedMatchId = queuedMatch.match_queue_id;
            const matchId = queuedMatch.match_id;
            const orderAsShown = queuedMatch.order_as_shown;

            return anagramsDb.getCountOfAnagramMatchesWithTweetInThisMatchAlreadyRetweeted(matchId).then(count => {
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
                    return matchQueueDb.updateQueuedMatchAsPosted(queuedMatchId);
                }
            }).then(x => {
                logger.info(`successfully dequeued and posted ${queuedMatchId} for match ${matchId}`);
            }).catch(error => {
                if (isRateLimited(error)) {
                    console.log(`rate limited when dequeuing ${queuedMatchId} for match ${matchId}`);
                } else {
                    logger.error(error);
                    return matchQueueDb.updateQueuedMatchAsError(queuedMatchId, error).then(x => {
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

exports.cleanUpAnyBrokenPairsInRecentRetweets = function() {
    logger.cleanUp.info("Starting cleanup of broken pairs.");
    return Promise.all([
        // always get more tweets than the number of matches*2
        // so the retrieved timeline doesn't break on a dangling pair
        twitter.getPastTweetsUpTo3200(800),
        anagramsDb.getMostRecentRetweetedStatusIds(300),
    ]).then(([timelineTweets, mostRecentRetweets]) => {
        console.log(`retrieved ${timelineTweets.length} timeline tweets`);
        let statusIdsOfRetweetsOnTimeline = new Set(timelineTweets.map(x => x.retweeted_status.id_str));
        return findStatusIdsWithMissingCorrespondingStatusId(statusIdsOfRetweetsOnTimeline, mostRecentRetweets);
    }).then(matchesWithMissingPair => {
        if (matchesWithMissingPair.length > 0) {
            console.log(matchesWithMissingPair);
            const matchIds = matchesWithMissingPair.map(x => `[${x.id}]`).join(", ");
            logger.cleanUp.info(`deleting matches: ${matchIds}`);
        }
        return Promise.all(matchesWithMissingPair.map(x => {
            return Promise.all([
                Promise.resolve(x),
                destroyTweet(x.missingTweetRetweetId),
                destroyTweet(x.existingTweetRetweetId)
            ]).then(deletions => {
                return anagramsDb.setUnretweetedFromTimelineCleanup(x.id).then(x => {
                    return deletions;
                });
            });
        }));
    }).then(allDeletions => {
        if (allDeletions.length == 0) {
            logger.cleanUp.info("No tweets to clean up.");
        } else {
            for (let deletion of allDeletions) {
                logDeletion(deletion);
            }
        }
    }).catch(err => {
        logger.cleanUp.error("unhandled error when cleaning up timeline");
        logger.cleanUp.error(err);
    });
};

function logDeletion(deletion) {
    const [pair, t1Deletion, t2Deletion] = deletion;
    logger.cleanUp.info(`Destroyed tweets ${pair.missingTweetRetweetId} and ${pair.existingTweetRetweetId} for ${pair.id}:`);
    logTweetDestruction(t1Deletion);
    logTweetDestruction(t2Deletion);
}

function logTweetDestruction(deletion) {
    if (deletion.error) {
        logger.cleanUp.info(`error when deleting: ${deletion.result}`);
    } else {
        logger.cleanUp.info(`Deleted ${deletion.id_str} created on ${deletion.created_at} ("${deletion.retweeted_status.text}", original status id ${deletion.retweeted_status.id_str})`);
    }
}

function destroyTweet(retweetId) {
    return twitter.destroyTweet(retweetId).catch(e => {
        return {
            error: true,
            result: e
        }
    });
}

function findStatusIdsWithMissingCorrespondingStatusId(setOfStatusIdsOnTimeline, mostRecentRetweets) {
    const tweetIdToMatchId = new Map();
    for (const match of mostRecentRetweets) {
        tweetIdToMatchId.set(match.t1_status_id, {
            matchId : match.id,
            thisTweetId: match.t1_status_id,
            thisTweetRetweetId: match.tweet1_retweet_id,
            otherTweetId: match.t2_status_id,
            otherTweetRetweetId: match.tweet2_retweet_id,
            dateRetweeted: match.date_retweeted
        });
        tweetIdToMatchId.set(match.t2_status_id, {
            matchId : match.id,
            thisTweetId: match.t2_status_id,
            thisTweetRetweetId: match.tweet2_retweet_id,
            otherTweetId: match.t1_status_id,
            otherTweetRetweetId: match.tweet1_retweet_id,
            dateRetweeted: match.date_retweeted
        });
    }

    const matchesWithMissingPair = [];
    for (const tweetId of setOfStatusIdsOnTimeline) {

        const matchingTweet = tweetIdToMatchId.get(tweetId);

        if (matchingTweet && !setOfStatusIdsOnTimeline.has(matchingTweet.otherTweetId)) {
            matchesWithMissingPair.push({
                missingTweet: matchingTweet.otherTweetId,
                missingTweetRetweetId: matchingTweet.otherTweetRetweetId,
                existingTweet: tweetId,
                existingTweetRetweetId: matchingTweet.thisTweetRetweetId,
                id: matchingTweet.matchId,
                dateRetweeted: matchingTweet.dateRetweeted
            });
        }
    }

    return matchesWithMissingPair;
}

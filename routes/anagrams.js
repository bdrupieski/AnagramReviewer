const express = require('express');
const router = express.Router();
const anagramsDb = require('../db/anagrams');
const matchQueueDb = require('../db/matchQueue');
const passportConfig = require("../services/passport");
const twitter = require("../services/twitter");
const logger = require('../services/logger');
const tumblr = require("../services/tumblr");
const countdown = require("countdown");
const anagramManagement = require('../services/anagramManagement');
const _ = require("lodash");

router.get('/*', passportConfig.isLoggedIn);

router.get('/', function (req, res) {
    res.redirect('/anagrams/list');
});

router.get('/list', function (req, res) {

    return matchQueueDb.getCountOfErrorQueuedMatches().then(count => {
        const responseData = {
            title: 'Anagrams',
            defaultInterestingFactor: anagramsDb.defaultInterestingFactor
        };

        if (count > 0) {
            responseData.errorMessage = count == 1
                ? `There is ${count} queued match with an error.`
                : `There are ${count} queued matches with an error.`;
        }

        res.render('anagrams/list', responseData);
    }).catch(error => {
        logger.error(error.toString());
        req.flash('error', error.toString());
        res.redirect('/');
    });
});

router.get('/fullmatch/:matchId', function (req, res) {
    const matchId = req.params.matchId;
    anagramsDb.getAnagramMatchWithTweetInfo(matchId).then(match => {
        res.json({match: match});
    }).catch(error => {
        logger.error(error.toString());
        res.json({error: error});
    });
});

router.get('/ratelimits', function(req, res) {
    twitter.getAppAndStatusRateLimits().then(rateLimits => {
        res.render('anagrams/ratelimits', {
            limitsFormatted: [
                formatRateLimit(rateLimits.resources.application, '/application/rate_limit_status'),
                formatRateLimit(rateLimits.resources.statuses, '/statuses/show/:id'),
                formatRateLimit(rateLimits.resources.statuses, '/statuses/oembed')
            ],
            rateLimits: JSON.stringify(rateLimits, null, 4)
        });
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

function formatRateLimit(rateLimitCategory, key) {
    const rateLimit = rateLimitCategory[key];
    const resetDate = new Date(rateLimit.reset * 1000);
    const reset = countdown(resetDate);

    return {
        call: key,
        limit: rateLimit.limit,
        used: rateLimit.limit - rateLimit.remaining,
        remaining: rateLimit.remaining,
        reset: reset
    }
}

router.get('/statistics', function(req, res) {

    const interestingFactorCutoff = Number(req.query.interestingfactor) || anagramsDb.defaultInterestingFactor;
    const numberOfLastDaysToGetMatchesCreatedPerDay = Number(req.query.days) || 15;
    const minuteInterval = Number(req.query.minutes) || 15;

    Promise.all([
        anagramsDb.getCountOfAnagramMatches(),
        anagramsDb.getApproximateCountOfTweets(),
        anagramsDb.getCountOfMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        anagramsDb.getCountOfNotRejectedAndNotApprovedMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        matchQueueDb.getCountOfPendingQueuedMatches(),
        anagramsDb.getCountOfRetweetedMatches(),
        anagramsDb.getCountOfRejectedMatches(),
        anagramsDb.getDateLastMatchCreated(),
        anagramsDb.getRetweetsAndTumblrPostsByDay(numberOfLastDaysToGetMatchesCreatedPerDay),
        anagramsDb.getStatsByDateMatchCreated(numberOfLastDaysToGetMatchesCreatedPerDay),
        anagramsDb.getStatsByInterestingFactorBucket(),
        anagramsDb.getStatsByTimeOfDayMatchCreated(minuteInterval),
        anagramsDb.averageScoreSurplusForApprovedMatches(interestingFactorCutoff),
        anagramsDb.averageScoreSurplusForApprovedMatchesByInterestingFactorScoreBucket(),
    ]).then(stats => {
        const formattedStats = {
            countOfMatches: stats[0],
            approximateCountOfTweets: stats[1],
            countOfMatchesAboveCutoff: stats[2],
            countOfNotRejectedAndNotApprovedMatchesAboveCutoff: stats[3],
            countOfPendingQueuedMatches: stats[4],
            countOfRetweetedMatches: stats[5],
            countOfRejectedMatches: stats[6],
            dateLastMatchCreated: stats[7],
            retweetsAndTumblrByDay: stats[8],
            statsByDateMatchCreated: stats[9],
            statsByInterestingFactorBucket: stats[10],
            statsByTimeOfDayMatchCreated: stats[11],
            scoreSurplusForApprovedMatches: stats[12],
            scoreSurplusForApprovedMatchesByInterestingFactorBucket: stats[13],
        };

        formattedStats.interestingFactorCutoff = interestingFactorCutoff;
        formattedStats.numberOfDaysToGetMatchesPerDay = numberOfLastDaysToGetMatchesCreatedPerDay;
        formattedStats.minuteInterval = minuteInterval;

        formattedStats.countOfNotRejectedAndNotApprovedMatchesAboveCutoffIsOne =
            formattedStats.countOfNotRejectedAndNotApprovedMatchesAboveCutoff == 1;
        formattedStats.countOfPendingQueuedMatchesIsOne = formattedStats.countOfPendingQueuedMatches == 1;

        formattedStats.tweetsPerMatch = formattedStats.approximateCountOfTweets / formattedStats.countOfMatches;
        formattedStats.countOfRetweetedTweets = formattedStats.countOfRetweetedMatches * 2;
        formattedStats.sumRetweetedMatchesOverPastDays = _.sum(formattedStats.retweetsAndTumblrByDay.map(x => Number(x.retweeted)));
        formattedStats.averageRetweetedMatchesPerDay = formattedStats.sumRetweetedMatchesOverPastDays / formattedStats.numberOfDaysToGetMatchesPerDay;

        formattedStats.retweetsAndTumblrByDayJson = JSON.stringify(formattedStats.retweetsAndTumblrByDay);
        formattedStats.statsByDateMatchCreatedJson = JSON.stringify(formattedStats.statsByDateMatchCreated);
        formattedStats.statsByTimeOfDayMatchCreatedJson = JSON.stringify(formattedStats.statsByTimeOfDayMatchCreated);
        formattedStats.statsByInterestingFactorBucketJson = JSON.stringify(formattedStats.statsByInterestingFactorBucket);
        formattedStats.scoreSurplusForApprovedMatchesByInterestingFactorBucketJson = JSON.stringify(formattedStats.scoreSurplusForApprovedMatchesByInterestingFactorBucket);

        return formattedStats;
    }).then(stats => {
        res.render('anagrams/statistics', {
            stats: stats
        });
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.post('/statistics', function(req, res) {
    const interestingFactor = req.body.interestingfactor;
    const days = req.body.days;
    const minutes = req.body.minutes;
    res.redirect(`/anagrams/statistics?interestingfactor=${interestingFactor}&days=${days}&minutes=${minutes}`);
});

router.get('/interestingfactorsforday/:dateString', function (req, res) {
    const date = new Date(req.params.dateString).toLocaleDateString("en-US");
    anagramsDb.getInterestingFactorsForMatchesCreatedOnDate(date).then(interestingFactors => {
        res.json({interestingFactors: interestingFactors, date: date});
    }).catch(error => {
        logger.error(error.toString());
        res.json({error: error});
    });
});

router.get('/exacttweetcount', function(req, res) {
    anagramsDb.getExactCountOfTweets().then(count => {
        res.json({count: count});
    }).catch(error => {
        logger.error(error.toString());
        res.json({error: error});
    });
});

router.get('/dateofoldesttweetwhoseexistencehasnotbeenchecked', function(req, res) {
    anagramsDb.getDateOfOldestTweetWhoseExistenceHasNotBeenChecked().then(date => {
        res.json({date: date});
    }).catch(error => {
        logger.error(error.toString());
        res.json({error: error});
    });
});

router.get('/nwaymatches', function(req, res) {

    const minMatchesPerGroup = Number(req.query.minmatchespergroup) || 5;

    anagramsDb.getNWayMatches(minMatchesPerGroup).then(matches => {

        matchesInGroups = _.chain(matches)
            .groupBy(x => x.stripped_sorted_text)
            .toPairs()
            .map(x => {
                const obj =  {
                    strippedText: x[0],
                    originalText: _.map(x[1], y => {
                        return {
                            id: y.id,
                            text: y.original_text
                        };
                    })
                };
                obj.count = obj.originalText.length;
                return obj;
            })
            .value();

        res.render('anagrams/nwaymatches', {
            minMatchesPerGroup: minMatchesPerGroup,
            matches: matchesInGroups
        });
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.post('/nwaymatches', function(req, res) {
    const minMatchesPerGroup = req.body.minmatchespergroup;
    res.redirect(`/anagrams/nwaymatches?minmatchespergroup=${minMatchesPerGroup}`);
});

router.get('/unretweetmanually', function(req, res) {
    anagramsDb.getMostRecentRetweetedMatches(500).then(matches => {
        res.render('anagrams/unretweetmanually', {
            matches: matches
        });
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.post('/unretweetmanually/:id', function(req, res) {

    const matchId = req.params.id;
    const unretweet = req.query.unretweet === "true";
    const deleteFromTumblr = req.query.deletetumblrpost === "true";

    if (!unretweet && !deleteFromTumblr) {
        req.flash('error', "Neither 'unretweet' or 'deletetumblrpost' were set");
        return res.redirect('/anagrams/list');
    } else {
        return anagramsDb.getAnagramMatch(matchId).then(match => {

            const deletePromises = [];

            if (unretweet && match.tweet1_retweet_id && match.tweet2_retweet_id) {
                deletePromises.push(twitter.destroyTweet(match.tweet1_retweet_id));
                deletePromises.push(twitter.destroyTweet(match.tweet2_retweet_id));
            }

            if (deleteFromTumblr && match.tumblr_post_id) {
                logger.info(`unposting tumblr ${match.tumblr_post_id}}`);
                deletePromises.push(tumblr.client.deletePost("anagrammatweest", {id: match.tumblr_post_id}));
            }

            return Promise.all(deletePromises);
        }).then(x => {
            return anagramsDb.setUnpostedAndClearIds(matchId, unretweet, deleteFromTumblr);
        }).then(x => {

            const actions = [];
            if (unretweet) {
                actions.push("unretweeted");
            }
            if (deleteFromTumblr) {
                actions.push("untumblr'd");
            }
            const combinedActions = actions.join(" and ");

            req.flash('info', `${combinedActions} match ${matchId}`);
            res.redirect('/anagrams/list');
        }).catch(err => {
            logger.error(err.toString());
            req.flash('error', err.toString());
            res.redirect('/anagrams/list');
        });
    }
});

router.get('/unrejectmanually', function(req, res) {
    anagramsDb.getMostRecentRejectedMatches(500).then(matches => {
        res.render('anagrams/unrejectmanually', {
            matches: matches
        });
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.post('/unrejectmanually/:id', function(req, res) {

    const matchId = req.params.id;

    anagramsDb.unrejectMatch(matchId).then(x => {
        req.flash('info', `Unrejected match ${matchId}`);
        res.redirect('/anagrams/list');
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.get('/queuestatus', function(req, res) {
    return Promise.all([
        matchQueueDb.getCountOfPendingQueuedMatches(),
        matchQueueDb.getCountOfPostedQueueMatches(),
        matchQueueDb.getCountOfErrorQueuedMatches(),
        matchQueueDb.getCountOfObservedErrorQueuedMatches(),
        matchQueueDb.getCountOfRemovedQueueMatches(),
        matchQueueDb.getPendingQueuedMatches(),
        matchQueueDb.getErrorQueuedMatches()
    ]).then(queueStatus => {

        const formattedQueueStatus = {
            pendingCount: queueStatus[0],
            postedCount: queueStatus[1],
            errorCount: queueStatus[2],
            errorObservedCount: queueStatus[3],
            removedCount: queueStatus[4],
            pendingQueueMatches: queueStatus[5],
            errorQueueMatches: queueStatus[6]
        };

        res.render('anagrams/queuestatus', {
            queueStatus: formattedQueueStatus
        });
    }).catch(error => {
        logger.error(error.toString());
        req.flash('error', error.toString());
        res.redirect('/anagrams/list');
    });
});

router.get('/more/:queryType', function (req, res) {
    const cutoff = parseFloat(req.query.cutoff);
    const topMatches = anagramsDb.findMatches(req.params.queryType, 15, cutoff).then(anagramMatches => {
        res.json({anagramMatches: anagramMatches});
    }).catch(err => {
        logger.error(err.message);
        res.json({error: err.message});
    });
});

router.post('/reject/:id', function (req, res) {

    const matchId = req.params.id;

    const topMatches = anagramsDb.rejectMatch(matchId).then(result => {
        res.json({successMessage: `Rejected match ${matchId}.`, remove: true});
    }).catch(err => {
        logger.error(err.message || err);
        res.json({error: err.message || err});
    });
});

router.post('/approve/:id', function (req, res) {

    const matchId = req.params.id;
    const orderAsShown = req.body.orderAsShown === "true";

    anagramsDb.markAttemptedApprovalForMatch(matchId).then(x => {
        return anagramsDb.getCountOfAnagramMatchesWithTweetInThisMatchAlreadyRetweeted(matchId);
    }).then(count => {
        if (count > 0) {
            return anagramManagement.postToTumblr(matchId, orderAsShown);
        } else {
            return anagramManagement.retweetAndPostToTumblr(matchId, orderAsShown);
        }
    }).then(response => {
        return res.json(response);
    });
});

router.post('/enqueue/:id', function (req, res) {

    const matchId = req.params.id;
    const orderAsShown = req.body.orderAsShown === "true";

    return anagramsDb.markAttemptedApprovalForMatch(matchId).then(x => {
        return anagramManagement.checkExistenceAndAutoRejectIfTweetsDontExist(matchId);
    }).then(response => {
        if (response.error) {
            res.json(response);
        } else {
            return matchQueueDb.getPendingQueuedCountForMatch(matchId).then(count => {
                if (count > 0) {
                    throw `${count} existing pending queued matches for ${matchId}`;
                } else {
                    return matchQueueDb.enqueueMatch(matchId, orderAsShown);
                }
            }).then(x => {
                res.json({successMessage: `Enqueued ${matchId}.`, remove: true});
            }).catch(error => {
                logger.error(error);
                res.json({error: error});
            });
        }
    });
});

router.post('/queue/remove/:id', function(req, res) {

    const queuedMatchId = req.params.id;

    return matchQueueDb.updateQueuedMatchAsRemoved(queuedMatchId).then(x => {
        req.flash('info', `Changed queued match ${queuedMatchId} to removed.`);
        res.redirect('/anagrams/list');
    }).catch(error => {
        logger.error(error.toString());
        req.flash('error', error.toString());
        res.redirect('/anagrams/list');
    });
});

router.post('/queue/markerrorok/:id', function(req, res) {
    const queuedMatchId = req.params.id;

    return matchQueueDb.updateQueuedMatchAsErrorObserved(queuedMatchId).then(x => {
        req.flash('info', `Marked queued match with error ${queuedMatchId} as observed.`);
        res.redirect('/anagrams/list');
    }).catch(error => {
        logger.error(error.toString());
        req.flash('error', error.toString());
        res.redirect('/anagrams/list');
    });
});

router.post('/cleanup', function (req, res) {

    let retweetIds;

    twitter.getPastTweetsUpTo3200().then(timelineTweets => {
        console.log(`${timelineTweets.length} timeline tweets`);
        retweetIds = new Set(timelineTweets.map(x => x.retweeted_status.id_str));
        return anagramsDb.getRetweetedStatusIds();
    }).then(matches => {
        const tweetIdToMatchId = new Map();
        for (const match of matches) {
            tweetIdToMatchId.set(match.t1_status_id, {matchId : match.id, otherTweetId: match.t2_status_id});
            tweetIdToMatchId.set(match.t2_status_id, {matchId : match.id, otherTweetId: match.t1_status_id});
        }

        const matchesWithMissingPair = [];
        for (const tweetId of retweetIds) {

            const matchingTweet = tweetIdToMatchId.get(tweetId);

            if (!retweetIds.has(matchingTweet.otherTweetId)) {
                matchesWithMissingPair.push({ missingTweet: matchingTweet.otherTweetId, existingTweet: tweetId, id: matchingTweet.matchId});
            }
        }

        if (matchesWithMissingPair.length > 0) {
            console.log(matchesWithMissingPair);
        }
        return matchesWithMissingPair;

    }).then(matchesWithMissingPair => {
        return Promise.all(matchesWithMissingPair.map(x => {

            return twitter.getTweets(x.missingTweet, x.existingTweet).then(tweets => {
                x.bothExist = true;
                return x;
            }).catch(err => {
                x.bothExist = false;
                return x;
            }).then(pair => {
                if (x.bothExist == true) {
                    throw `both tweets still exist for ${x.id}`;
                } else {
                    return anagramsDb.setUnretweeted(x.id);
                }
            }).then(matchUnretweetedUpdate => {
                return anagramsDb.getAnagramMatch(x.id);
            }).then(match => {
                return Promise.all([
                    twitter.destroyTweet(match.tweet1_retweet_id).catch(e => e),
                    twitter.destroyTweet(match.tweet2_retweet_id).catch(e => e)
                ]);
            }).then(deletions => {
                logger.info("existingTweetDeletion: " + deletions[0]);
                logger.info("missingTweetDeletion: " + deletions[1]);
                return deletions;
            });
        }));
    }).then(deletions => {
        if (deletions.length == 0) {
            req.flash('info', "No tweets to clean up.");
            res.redirect('/anagrams/list');
        } else {
            res.render('anagrams/cleanup', {
                deletions: JSON.stringify(deletions, null, 4)
            });
        }
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.post('/bulkpostmissingtumblrposts', function (req, res) {
    anagramsDb.getTweetsToPostToTumblr(25).then(matches => {
        if (matches.length == 0) {
            req.flash('info', "No missing tumblr posts.");
            res.redirect('/anagrams/list');
        } else {
            return Promise.all(matches.map(x => postMatchToTumblr(x.id, x.t1_status_id, x.t2_status_id))).then(x => {
                req.flash('info', `posted ${x.length} to tumblr`);
                res.redirect('/anagrams/list');
            });
        }
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

module.exports = router;

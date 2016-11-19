const express = require('express');
const router = express.Router();
const anagramsDb = require('../db/anagrams');
const passportConfig = require("../services/passport");
const twitter = require("../services/twitter");
const logger = require('winston');
const tumblr = require("../services/tumblr");
const countdown = require("countdown");
const anagramManagement = require('../services/anagramManagement');

router.get('/*', passportConfig.isLoggedIn);

router.get('/', function (req, res) {
    res.redirect('/anagrams/list');
});

router.get('/list', function (req, res) {

    return anagramsDb.getCountOfErrorQueuedMatches().then(count => {
        const responseData = {
            title: 'Anagrams'
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

    const interestingFactorCutoff = Number(req.query.interestingfactor) || 0.67;
    const numberOfLastDaysToGetMatchesCreatedPerDay = Number(req.query.days) || 15;
    const minuteInterval = Number(req.query.minutes) || 5;

    Promise.all([
        anagramsDb.getCountOfAnagramMatches(),
        anagramsDb.getApproximateCountOfTweets(),
        anagramsDb.getCountOfMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        anagramsDb.getCountOfNotRejectedAndNotApprovedMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        anagramsDb.getCountOfPendingQueuedMatches(),
        anagramsDb.getCountOfRetweetedMatches(),
        anagramsDb.getCountOfRejectedMatches(),
        anagramsDb.getDateLastMatchCreated(),
        anagramsDb.getRetweetsAndTumblrPostsByDay(numberOfLastDaysToGetMatchesCreatedPerDay),
        anagramsDb.getStatsByDateMatchCreated(numberOfLastDaysToGetMatchesCreatedPerDay),
        anagramsDb.getStatsByInterestingFactorBucket(),
        anagramsDb.getStatsByTimeOfDayMatchCreated(minuteInterval),
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
        };

        formattedStats.interestingFactorCutoff = interestingFactorCutoff;
        formattedStats.numberOfDaysToGetMatchesPerDay = numberOfLastDaysToGetMatchesCreatedPerDay;
        formattedStats.minuteInterval = minuteInterval;

        formattedStats.countOfNotRejectedAndNotApprovedMatchesAboveCutoffIsOne =
            formattedStats.countOfNotRejectedAndNotApprovedMatchesAboveCutoff == 1;
        formattedStats.countOfPendingQueuedMatchesIsOne = formattedStats.countOfPendingQueuedMatches == 1;

        formattedStats.tweetsPerMatch = formattedStats.approximateCountOfTweets / formattedStats.countOfMatches;
        formattedStats.countOfRetweetedTweets = formattedStats.countOfRetweetedMatches * 2;

        formattedStats.retweetsAndTumblrByDayJson = JSON.stringify(formattedStats.retweetsAndTumblrByDay);
        formattedStats.statsByDateMatchCreatedJson = JSON.stringify(formattedStats.statsByDateMatchCreated);
        formattedStats.statsByTimeOfDayMatchCreatedJson = JSON.stringify(formattedStats.statsByTimeOfDayMatchCreated);
        formattedStats.statsByInterestingFactorBucketJson = JSON.stringify(formattedStats.statsByInterestingFactorBucket);

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

router.get('/unretweetmanually', function(req, res) {
    anagramsDb.getMostRecentRetweetedMatches().then(matches => {
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
    const deleteFromTumblr = req.query.deletetumblrpost === "true";

    anagramsDb.getAnagramMatch(matchId).then(match => {

        const unretweetPromises = [
            twitter.destroyTweet(match.tweet1_retweet_id),
            twitter.destroyTweet(match.tweet2_retweet_id)
        ];

        if (deleteFromTumblr) {
            unretweetPromises.push(tumblr.client.deletePost("anagrammatweest", {id: match.tumblr_post_id}));
        }

        return Promise.all(unretweetPromises);
    }).then(x => {
        return anagramsDb.setUnretweetedAndClearRetweetIds(matchId, deleteFromTumblr);
    }).then(x => {
        req.flash('info', `Unretweeted match ${matchId}`);
        res.redirect('/anagrams/list');
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.get('/unrejectmanually', function(req, res) {
    anagramsDb.getMostRecentRejectedMatches().then(matches => {
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
        anagramsDb.getCountOfPendingQueuedMatches(),
        anagramsDb.getCountOfPostedQueueMatches(),
        anagramsDb.getCountOfErrorQueuedMatches(),
        anagramsDb.getCountOfObservedErrorQueuedMatches(),
        anagramsDb.getCountOfRemovedQueueMatches(),
        anagramsDb.getPendingQueuedMatches(),
        anagramsDb.getErrorQueuedMatches()
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
            return anagramsDb.getPendingQueuedCountForMatch(matchId).then(count => {
                if (count > 0) {
                    throw `${count} existing pending queued matches for ${matchId}`;
                } else {
                    return anagramsDb.enqueueMatch(matchId, orderAsShown);
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

    return anagramsDb.updateQueuedMatchAsRemoved(queuedMatchId).then(x => {
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

    return anagramsDb.updateQueuedMatchAsErrorObserved(queuedMatchId).then(x => {
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

const express = require('express');
const router = express.Router();
const anagramsDb = require('../db/anagrams');
const passportConfig = require("../services/passport");
const twitter = require("../services/twitter");
const logger = require('winston');
const tumblr = require("../services/tumblr");
const countdown = require("countdown");
const _ = require("lodash");

router.get('/*', passportConfig.isLoggedIn);

router.get('/', function (req, res) {
    res.redirect('/anagrams/list');
});

router.get('/list', function (req, res) {
    res.render('anagrams/list', {
        title: 'Anagrams'
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

    const interestingFactorCutoff = req.query.interestingfactor || 0.67;
    const numberOfLastDaysToGetMatchesCreatedPerDay = req.query.days || 15;

    Promise.all([
        anagramsDb.getCountOfAnagramMatches(),
        anagramsDb.getApproximateCountOfTweets(),
        anagramsDb.getCountOfMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        anagramsDb.getCountOfNotRejectedAndNotApprovedMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        anagramsDb.getCountOfRetweetedMatches(),
        anagramsDb.getCountOfRejectedMatches(),
        anagramsDb.getDateLastMatchCreated(),
        anagramsDb.getRetweetsAndTumblrPostsByDay(numberOfLastDaysToGetMatchesCreatedPerDay),
        anagramsDb.getStatsByDateMatchCreated(numberOfLastDaysToGetMatchesCreatedPerDay),
        anagramsDb.getStatsByInterestingFactorBucket()
    ]).then(stats => {
        var formattedStats = {
            countOfMatches: stats[0],
            approximateCountOfTweets: stats[1],
            countOfMatchesAboveCutoff: stats[2],
            countOfNotRejectedAndNotApprovedMatchesAboveCutoff: stats[3],
            countOfRetweetedMatches: stats[4],
            countOfRejectedMatches: stats[5],
            interestingFactorCutoff: interestingFactorCutoff,
            dateLastMatchCreated: stats[6],
            retweetsAndTumblrByDay: stats[7],
            statsByDateMatchCreated: stats[8],
            numberOfDaysToGetMatchesPerDay: numberOfLastDaysToGetMatchesCreatedPerDay,
            statsByInterestingFactorBucket: stats[9]
        };

        formattedStats.tweetsPerMatch = formattedStats.approximateCountOfTweets / formattedStats.countOfMatches;
        formattedStats.countOfRetweetedTweets = formattedStats.countOfRetweetedMatches * 2;

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
            return postToTumblr(matchId, orderAsShown);
        } else {
            return retweetAndPostToTumblr(matchId, orderAsShown);
        }
    }).then(response => {
        return res.json(response);
    });
});

function retweetAndPostToTumblr(matchId, orderAsShown) {

    let originalTweets, retweet1, retweet2;

    return anagramsDb.getTweetsForMatch(matchId).then(tweets => {
        return twitter.getTweets(tweets.tweet1.status_id, tweets.tweet2.status_id);
    }).then(tweets => {

        if (!orderAsShown) {
            var temp = tweets.tweet1;
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
        return anagramsDb.approveMatch(matchId, retweet1.id_str, retweet2.id_str);
    }).then(x => {
        return postMatchToTumblr(matchId, originalTweets.tweet1.id_str, originalTweets.tweet2.id_str).then(x => {
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
            return autoRejectFromTwitterError(matchId, error);
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
}

function postToTumblr(matchId, orderAsShown) {
    return anagramsDb.getTweetsForMatch(matchId).then(tweets => {
        return twitter.getTweets(tweets.tweet1.status_id, tweets.tweet2.status_id);
    }).then(tweets => {

        if (!orderAsShown) {
            const temp = tweets.tweet1;
            tweets.tweet1 = tweets.tweet2;
            tweets.tweet2 = temp;
        }

        return postMatchToTumblr(matchId, tweets.tweet1.id_str, tweets.tweet2.id_str);
    }).then(x => {
        return {successMessage: "Match contains retweet. Posted to tumblr.", remove: true};
    }).catch(error => {

        if (Array.isArray(error)) {
            return autoRejectFromTwitterError(matchId, error);
        }

        logger.error(error);
        return {error: `error posting ${matchId} to tumblr: ${error}`};
    });
}

function autoRejectFromTwitterError(matchId, error) {
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
}

router.post('/cleanup', function (req, res) {

    let retweetIds;

    twitter.getPastTweetsUpTo3200().then(timelineTweets => {
        console.log(`${timelineTweets.length} timeline tweets`);
        retweetIds = new Set(timelineTweets.map(x => x.retweeted_status.id_str));
        return anagramsDb.getRetweetedStatusIds();
    }).then(matches => {
        var tweetIdToMatchId = new Map();
        for (let match of matches) {
            tweetIdToMatchId.set(match.t1_status_id, {matchId : match.id, otherTweetId: match.t2_status_id});
            tweetIdToMatchId.set(match.t2_status_id, {matchId : match.id, otherTweetId: match.t1_status_id});
        }

        const matchesWithMissingPair = [];
        for (let tweetId of retweetIds) {

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

function postMatchToTumblr(matchId, t1StatusId, t2StatusId) {
    return Promise.all([
        twitter.oembedTweet(t1StatusId),
        twitter.oembedTweet(t2StatusId)
    ]).then(oembeds => {

        const t1 = oembeds[0];
        const t2 = oembeds[1];

        const title = `${t1.author_name} vs. ${t2.author_name}`;
        const content = `<div> ${t1.html} <br><br> ${t2.html} </div>`;

        return tumblr.client.createTextPost("anagrammatweest", { title: title, body: content });
    }).then(tumblrResponse => {
        const tumblrPostId = tumblrResponse.id;
        logger.info(`posted tumblr post id: ${tumblrPostId}`);
        return anagramsDb.updateTumblrPostId(matchId, tumblrPostId);
    });
}

module.exports = router;

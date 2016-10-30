var express = require('express');
var router = express.Router();
var anagramsDb = require('../db/anagrams');
var passportConfig = require("../services/passport");
var twitter = require("../services/twitter");
var logger = require('winston');

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
    twitter.getRateLimits(["application", "statuses"]).then(rateLimits => {
        res.render('anagrams/ratelimits', {
            rateLimits: JSON.stringify(rateLimits, null, 4)
        });
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/anagrams/list');
    });
});

router.get('/statistics', function(req, res) {

    let interestingFactorCutoff = req.query.interestingfactor || 0.75;
    let numberOfLastDaysToGetMatchesCreatedPerDay = req.query.days || 100;

    Promise.all([
        anagramsDb.getCountOfAnagramMatches(),
        anagramsDb.getApproximateCountOfTweets(),
        anagramsDb.getCountOfMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        anagramsDb.getCountOfNotRejectedAndNotApprovedMatchesWithInterestingFactorGreaterThan(interestingFactorCutoff),
        anagramsDb.getCountOfRetweetedMatches(),
        anagramsDb.getCountOfRejectedMatches(),
        anagramsDb.getDateLastMatchCreated(),
        anagramsDb.getMatchesCreatedPerDay(numberOfLastDaysToGetMatchesCreatedPerDay)
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
            matchesPerDay: stats[7],
            numberOfDaysToGetMatchesPerDay: numberOfLastDaysToGetMatchesCreatedPerDay
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

router.get('/more/:queryType', function (req, res) {
    var cutoff = parseFloat(req.query.cutoff);
    var topMatches = anagramsDb.findMatches(req.params.queryType, 15, cutoff).then(anagramMatches => {
        res.json({anagramMatches: anagramMatches});
    }).catch(err => {
        logger.error(err.message);
        res.json({error: err.message});
    });
});

router.post('/reject/:id', function (req, res) {

    var matchId = req.params.id;

    var topMatches = anagramsDb.rejectMatch(matchId).then(result => {
        res.json({successMessage: `Rejected match ${matchId}.`, remove: true});
    }).catch(err => {
        logger.error(err.message || err);
        res.json({error: err.message || err});
    });
});

router.post('/approve/:id', function (req, res) {

    var matchId = req.params.id;
    var orderAsShown = req.body.orderAsShown === "true";

    var originalTweets, retweet1, retweet2;

    anagramsDb.getCountOfAnagramMatchesWithTweetInThisMatchAlreadyRetweeted(matchId).then(count => {
        if (count > 0) {
            throw "Match contains tweet that's already been retweeted."
        } else {
            return anagramsDb.getTweetsForMatch(matchId);
        }
    }).then(tweets => {
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
        var rateLimitRemaining = Math.min(originalTweets.tweet1.rateLimitRemaining, originalTweets.tweet2.rateLimitRemaining);
        res.json({successMessage: `Approved ${matchId}. ${rateLimitRemaining} calls remaining.`, remove: true});
    }).catch(err => {

        var approvalError = err.message || err;
        console.log(err);

        if (Array.isArray(err)) {

            var codes = err.map(x => x.code);
            var approvalErrorMessages = err.map(x => x.message).join();
            var rejectableCodes = twitter.autoRejectableErrors.map(x => x.code);

            if (intersection(codes, rejectableCodes).length > 0) {
                return anagramsDb.rejectMatch(matchId).then(x => {
                    return res.json({error: approvalErrorMessages, systemResponse: "Auto-rejected.", remove: true});
                }).catch(err => {
                    logger.error(err);
                    return res.json({error: approvalErrorMessages, systemResponse: "Auto-rejection failed: " + err, recoveryError: true});
                });
            } else {
                logger.error(approvalErrorMessages);
                return res.json({error: approvalErrorMessages});
            }
        }

        if (retweet1 || retweet2) {
            return Promise.all([retweet1, retweet2].filter(x => x).map(x => twitter.unretweet(x.id_str))).then(unretweet => {
                return res.json({error: approvalError, systemResponse: "Unretweeted."});
            }).catch(err => {
                logger.error(err);
                return res.json({error: approvalError, systemResponse: "Error unretweeting: " + err, recoveryError: true});
            });
        }

        return res.json({error: approvalError});
    });
});

router.post('/cleanup', function (req, res) {

    var retweetIds;

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

        var matchesWithMissingPair = [];
        for (let tweetId of retweetIds) {

            var matchingTweet = tweetIdToMatchId.get(tweetId);

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

function intersection(array1, array2) {
    return array1.filter(function(n) {
        return array2.indexOf(n) != -1;
    });
}

module.exports = router;

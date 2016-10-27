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
        anagramsDb.getDateLastMatchCreated(),
        anagramsDb.getMatchesCreatedPerDay(numberOfLastDaysToGetMatchesCreatedPerDay)
    ]).then(stats => {
        var formattedStats = {
            countOfMatches: stats[0],
            approximateCountOfTweets: stats[1],
            countOfMatchesAboveCutoff: stats[2],
            interestingFactorCutoff: interestingFactorCutoff,
            dateLastMatchCreated: stats[3],
            matchesPerDay: stats[4],
            numberOfDaysToGetMatchesPerDay: numberOfLastDaysToGetMatchesCreatedPerDay
        };

        formattedStats.tweetsPerMatch = formattedStats.approximateCountOfTweets / formattedStats.countOfMatches;

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
        originalTweets = tweets;
        return twitter.retweet(originalTweets.tweet1.id_str);
    }).then(retweet => {
        retweet1 = retweet;
        return twitter.retweet(originalTweets.tweet2.id_str);
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

function intersection(array1, array2) {
    return array1.filter(function(n) {
        return array2.indexOf(n) != -1;
    });
}

module.exports = router;

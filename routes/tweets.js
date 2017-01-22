const express = require('express');
const router = express.Router();
const anagramsDb = require('../db/anagrams');
const passportConfig = require("../services/passport");
const logger = require('../services/logger');
const _ = require("lodash");

router.get('/*', passportConfig.isLoggedIn);

router.get('/', function (req, res) {
    res.redirect('/');
});

router.get('/info/:tweetId', function (req, res) {
    const tweetId = req.params.tweetId;
    return Promise.all([
        anagramsDb.getTweet(tweetId),
        anagramsDb.otherMatchesWithTweet(tweetId),
    ]).then(tweetData => {
        res.render('tweets/info', {
            tweet: tweetData[0],
            otherMatches: tweetData[1],
        });
    }).catch(error => {
        logger.error(error.toString());
        req.flash('error', error.toString());
        res.redirect('/');
    });
});

module.exports = router;

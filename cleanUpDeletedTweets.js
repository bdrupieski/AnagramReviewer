var twitter = require('./services/twitter');
var fs = require('fs');
var _ = require('lodash');
var anagramsDb = require('./db/anagrams');
var logger = require('winston');

// twitter.getPastTweetsUpTo3200().then(x => {
//     fs.writeFileSync("timeline.txt", JSON.stringify(x, null, 4));
// });
// var file = fs.readFileSync("timeline.txt");
// var retweets = JSON.parse(file);
//console.log(retweets.length);
// var retweetIds = new Set(uniqueTweets.map(x => x.retweeted_status.id_str));
// console.log(uniqueTweets.length);

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

}).catch(err => {
    console.log("ERROR");
    console.log(err);
});
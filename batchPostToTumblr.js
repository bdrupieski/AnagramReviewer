var twitter = require('./services/twitter');
var anagramsDb = require('./db/anagrams');
var logger = require('winston');
var tumblr = require("./services/tumblr");

anagramsDb.getTweetsToPostToTumblr(25).then(matches => {

    console.log(`${matches.length} matches not yet posted to tumblr`);

    for (let match of matches) {
        postMatchToTumblr(match).then(x => {
            console.log(`success for ${match.id}`);
        }).catch(err => {
            console.log("oops:");
            logger.error(err);
        });
    }
});

function postMatchToTumblr(match) {
    return Promise.all([
        twitter.oembedTweet(match.t1_status_id),
        twitter.oembedTweet(match.t2_status_id)
    ]).then(oembeds => {

        const t1 = oembeds[0];
        const t2 = oembeds[1];

        const title = `${t1.author_name} vs. ${t2.author_name}`;
        const content = `<div> ${t1.html} <br><br> ${t2.html} </div>`;

        return tumblr.client.createTextPost("anagrammatweest", { title: title, body: content });
    }).then(tumblrResponse => {
        const tumblrPostId = tumblrResponse.id;
        return anagramsDb.updateTumblrPostId(match.id, tumblrPostId);
    });
}

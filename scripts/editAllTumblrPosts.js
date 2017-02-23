const tumblr = require("./../services/tumblr");
const anagramsDb = require('./../db/anagrams');
fs = require('fs');

const blogName = "anagrammatweest";
const doneFile = "done.txt";

let doneIds = [];
if (fs.existsSync(doneFile)) {
    const doneText = fs.readFileSync("done.txt", "utf8");
    doneIds = doneText.split("\r\n");
}

anagramsDb.getTumblrPostIds().then(postIds => {
    console.log(`Done: ${doneIds.length}`);
    const notDone = postIds.filter(x => doneIds.indexOf(x) <= -1);
    console.log(`Total: ${postIds.length}`);
    console.log(`Not done: ${notDone.length}`);

    const idChunk = notDone.slice(0, 500);
    return doIt(idChunk);

}).catch(error => {
    console.log("ERROR:");
    console.log(error);
});

function doIt(idChunk) {

    if (idChunk.length == 0) {
        return;
    }

    const [postId, ...restOfIds] = idChunk;

    return tumblr.client.blogPosts(blogName, {id: postId}).then(postsContent => {
        const post = postsContent.posts[0];
        const body = post.body;
        const id = post.id;
        const title = post.title;
        const fixedBody = body.replace("<br/><br/>", "");
        return tumblr.client.editPost(blogName, {id: id, body: fixedBody});
    }).then(x => {
        fs.appendFileSync(doneFile, x.id + "\r\n", "utf8");
        return doIt(restOfIds);
    }).catch(error => {
        console.log("ERROR:");
        console.log(error);
    });
}

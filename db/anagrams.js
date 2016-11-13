var pools = require('./poolProvider');

let maxMatchLimit = 50;
let defaultInterestingFactor = 0.67;
let topMatchesQueryType = "topmatches";
let oldestTopMatchesQueryType = "oldesttopmatches";
let mostRecentMatches = "mostrecentmatches";

let topMatchQueryTypes = [topMatchesQueryType, oldestTopMatchesQueryType, mostRecentMatches];

exports.findMatches = function (topMatchQueryType, limit = maxMatchLimit, interestingFactorCutoff = defaultInterestingFactor) {

    if (!topMatchQueryTypes.includes(topMatchQueryType)) {
        throw `topMatchQueryType ${topMatchQueryType} is invalid`;
    }

    limit = Math.min(limit, maxMatchLimit);
    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    if (topMatchQueryType == topMatchesQueryType) {
        return findTopMatches(limit);
    } else if (topMatchQueryType == oldestTopMatchesQueryType) {
        return findOldestTopMatches(limit, interestingFactorCutoff);
    } else if (topMatchQueryType == mostRecentMatches) {
        return findMostRecentMatches(limit);
    } else {
        throw `${topMatchQueryType} is invalid in a really weird way`;
    }
};

function findTopMatches(limit) {

    let topMatchesQuery = `
SELECT
  A.id,
  A.INTERESTING_FACTOR AS interesting,
  T1.ORIGINAL_TEXT     AS t1_originalText,
  T2.ORIGINAL_TEXT     AS t2_originalText,
  T1.USER_NAME         AS t1_username,
  T1.STATUS_ID         AS t1_statusId,
  T2.USER_NAME         AS t2_username,
  T2.STATUS_ID         AS t2_statusId
FROM
  ANAGRAM_MATCHES A
  INNER JOIN TWEETS T1 ON A.TWEET1_ID = T1.ID
  INNER JOIN TWEETS T2 ON A.TWEET2_ID = T2.ID
WHERE NOT A.rejected
      AND A.DATE_RETWEETED IS NULL
      AND A.tumblr_post_id IS NULL
ORDER BY
  A.INTERESTING_FACTOR DESC
limit $1::int;
`;

    return pools.anagramPool.query(topMatchesQuery, [limit]).then(x => {
        if (!x.rows) {
            throw x;
        } else {
            return x.rows;
        }
    });
}

function findOldestTopMatches (limit, interestingFactorCutoff = defaultInterestingFactor) {

    let oldestTopMatchQuery = `
SELECT
  A.id,
  A.INTERESTING_FACTOR AS interesting,
  T1.ORIGINAL_TEXT     AS t1_originalText,
  T2.ORIGINAL_TEXT     AS t2_originalText,
  T1.USER_NAME         AS t1_username,
  T1.STATUS_ID         AS t1_statusId,
  T2.USER_NAME         AS t2_username,
  T2.STATUS_ID         AS t2_statusId,
  T1.CREATED_AT        AS t1_created,
  T2.CREATED_AT        AS t2_created
FROM
  ANAGRAM_MATCHES A
  INNER JOIN TWEETS T1 ON A.TWEET1_ID = T1.ID
  INNER JOIN TWEETS T2 ON A.TWEET2_ID = T2.ID
WHERE NOT A.rejected
      AND A.DATE_RETWEETED IS NULL
      AND A.tumblr_post_id IS NULL
      AND A.interesting_factor > $2::float
ORDER BY
  A.DATE_CREATED
LIMIT $1::int;
`;

    return pools.anagramPool.query(oldestTopMatchQuery, [limit, interestingFactorCutoff]).then(x => {
        if (!x.rows) {
            throw x;
        } else {
            return x.rows;
        }
    });
}

function findMostRecentMatches(limit) {

    let topMatchesQuery = `
SELECT
  A.id,
  A.INTERESTING_FACTOR AS interesting,
  T1.ORIGINAL_TEXT     AS t1_originalText,
  T2.ORIGINAL_TEXT     AS t2_originalText,
  T1.USER_NAME         AS t1_username,
  T1.STATUS_ID         AS t1_statusId,
  T2.USER_NAME         AS t2_username,
  T2.STATUS_ID         AS t2_statusId
FROM
  ANAGRAM_MATCHES A
  INNER JOIN TWEETS T1 ON A.TWEET1_ID = T1.ID
  INNER JOIN TWEETS T2 ON A.TWEET2_ID = T2.ID
WHERE NOT A.rejected
      AND A.date_retweeted IS NULL
      AND A.tumblr_post_id IS NULL
ORDER BY
  A.date_created DESC
LIMIT $1::int;
`;

    return pools.anagramPool.query(topMatchesQuery, [limit]).then(x => {
        if (!x.rows) {
            throw x;
        } else {
            return x.rows;
        }
    });
}

exports.rejectMatch = function (matchId, isAutoRejected = false) {

    let rejectMatchQuery = `
UPDATE anagram_matches
SET 
  rejected      = TRUE,
  date_rejected = current_timestamp,
  auto_rejected = $2::boolean
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(rejectMatchQuery, [matchId, isAutoRejected]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.unrejectMatch = function (matchId) {

    let unrejectMatchQuery = `
UPDATE anagram_matches
SET 
  rejected      = FALSE,
  date_rejected = NULL,
  auto_rejected = FALSE
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(unrejectMatchQuery, [matchId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.markAttemptedApprovalForMatch = function (matchId) {

    let markApprovalAttemptedQuery = `
UPDATE anagram_matches
SET attempted_approval = true
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(markApprovalAttemptedQuery, [matchId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.approveMatch = function (matchId, tweet1RetweetId, tweet2RetweetId) {

    let approveMatchQuery = `
UPDATE anagram_matches
SET
  tweet1_retweet_id = $2,
  tweet2_retweet_id = $3,
  date_retweeted    = current_timestamp
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(approveMatchQuery, [matchId, tweet1RetweetId, tweet2RetweetId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.updateTumblrPostId = function(matchId, tumblrPostId) {
    let updateTumblrPostIdQuery = `
UPDATE anagram_matches
SET
  tumblr_post_id = $2::bigint,
  date_posted_tumblr = current_timestamp
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(updateTumblrPostIdQuery, [matchId, tumblrPostId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

function getTweet(id) {
    let tweetByIdQuery = `
SELECT *
FROM tweets
WHERE id = $1::uuid
LIMIT 1
`;
    return pools.anagramPool.query(tweetByIdQuery, [id]).then(x => {
        return x.rows[0];
    });
}

exports.getAnagramMatch = function(id) {
    let anagramMatchByIdQuery = `
SELECT *
FROM anagram_matches
WHERE id = $1::int
LIMIT 1
`;
    return pools.anagramPool.query(anagramMatchByIdQuery, [id]).then(x => {
        return x.rows[0];
    });
};

exports.getTweetsForMatch = function (matchId) {
    return exports.getAnagramMatch(matchId).then(match => {
        return Promise.all([getTweet(match.tweet1_id), getTweet(match.tweet2_id)]);
    }).then(tweets => {
        return {
            tweet1: tweets[0],
            tweet2: tweets[1]
        }
    });
};

exports.getStatsByDateMatchCreated = function (numberOfPastDays = 30) {

    numberOfPastDays = Math.max(numberOfPastDays, 5);

    let statsByDateMatchCreated = `
SELECT
  DISTINCT ON (day)
  date(anagram_matches.date_created) AS day,
  count(1) OVER w AS matches_created,
  sum(CASE WHEN anagram_matches.attempted_approval = true THEN 1 ELSE 0 END) OVER w AS attempted_approval,
  sum(CASE WHEN anagram_matches.auto_rejected = true THEN 1 ELSE 0 END) OVER w AS auto_rejected,
  count(anagram_matches.date_retweeted) OVER w AS retweeted,
  count(anagram_matches.date_unretweeted) OVER w AS unretweeted,
  sum(CASE WHEN anagram_matches.rejected = true THEN 1 ELSE 0 END) OVER w AS rejected,
  count(anagram_matches.date_posted_tumblr) OVER w AS posted_to_tumblr
FROM anagram_matches
WINDOW w AS (
  PARTITION BY date(anagram_matches.date_created) )
ORDER BY day DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(statsByDateMatchCreated, [numberOfPastDays]).then(x => {
        return x.rows;
    });
};

exports.getStatsByInterestingFactorBucket = function () {

    let statsByInterestingFactorBucket = `
SELECT
  DISTINCT ON (score)
  trunc(anagram_matches.interesting_factor :: NUMERIC, 2) AS score,
  count(1) OVER w AS matches_created,
  sum(CASE WHEN anagram_matches.attempted_approval = true THEN 1 ELSE 0 END) OVER w AS attempted_approval,
  sum(CASE WHEN anagram_matches.auto_rejected = true THEN 1 ELSE 0 END) OVER w AS auto_rejected,
  count(anagram_matches.date_retweeted) OVER w AS retweeted,
  count(anagram_matches.date_unretweeted) OVER w AS unretweeted,
  sum(CASE WHEN anagram_matches.rejected = true THEN 1 ELSE 0 END) OVER w AS rejected,
  count(anagram_matches.date_posted_tumblr) OVER w AS posted_to_tumblr
FROM anagram_matches
WINDOW w AS (
  PARTITION BY trunc(anagram_matches.interesting_factor :: NUMERIC, 2) )
ORDER BY score DESC;
`;
    return pools.anagramPool.query(statsByInterestingFactorBucket).then(x => {
        return x.rows;
    });
};

exports.getRetweetsAndTumblrPostsByDay = function (numberOfPastDays = 30) {

    numberOfPastDays = Math.max(numberOfPastDays, 5);

    let retweetsAndTumblrPostsByDayQuery = `
SELECT
  COALESCE(retweeted.day, tumblr.day) as day,
  COALESCE(count_retweeted, 0) as retweeted,
  COALESCE(count_posted_tumblr, 0) as posted_to_tumblr
FROM (SELECT
        date(anagram_matches.date_retweeted) AS day,
        count(1)                             AS count_retweeted
      FROM anagram_matches
      WHERE date_retweeted IS NOT NULL
      GROUP BY day) AS retweeted
  FULL OUTER JOIN (SELECT
                     date(anagram_matches.date_posted_tumblr) AS day,
                     count(1)                                 AS count_posted_tumblr
                   FROM anagram_matches
                   WHERE date_posted_tumblr IS NOT NULL
                   GROUP BY day) AS tumblr ON retweeted.day = tumblr.day
ORDER BY day DESC
LIMIT $1::int
`;
    return pools.anagramPool.query(retweetsAndTumblrPostsByDayQuery, [numberOfPastDays]).then(x => {
        return x.rows;
    });
};

exports.getCountOfAnagramMatches = function () {
    let anagramMatchCountQuery = `
SELECT count(1)
FROM anagram_matches;
`;
    return pools.anagramPool.query(anagramMatchCountQuery).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getApproximateCountOfTweets = function () {
    let approximateTweetCountQuery = `
SELECT reltuples AS approximate_row_count FROM pg_class WHERE relname = 'tweets' LIMIT 1;
`;
    return pools.anagramPool.query(approximateTweetCountQuery).then(x => {
        return Number(x.rows[0].approximate_row_count);
    });
};

exports.getCountOfMatchesWithInterestingFactorGreaterThan = function (interestingFactorCutoff = defaultInterestingFactor) {

    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    let anagramMatchCountQuery = `
SELECT count(1)
FROM anagram_matches
WHERE interesting_factor > $1::float;
`;
    return pools.anagramPool.query(anagramMatchCountQuery, [interestingFactorCutoff]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getCountOfNotRejectedAndNotApprovedMatchesWithInterestingFactorGreaterThan = function (interestingFactorCutoff = defaultInterestingFactor) {

    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    let notRejectedAndNotApprovedAnagramMatchCountQuery = `
SELECT count(1)
FROM anagram_matches
WHERE interesting_factor > $1::float
      AND anagram_matches.rejected = FALSE
      AND anagram_matches.date_retweeted IS NULL
      AND anagram_matches.tumblr_post_id IS NULL
`;
    return pools.anagramPool.query(notRejectedAndNotApprovedAnagramMatchCountQuery, [interestingFactorCutoff]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getCountOfRetweetedMatches = function () {

    let retweetedMatchCountQuery = `
SELECT count(1)
FROM anagram_matches
WHERE date_retweeted IS NOT NULL
      AND date_unretweeted IS NULL;
`;
    return pools.anagramPool.query(retweetedMatchCountQuery).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getCountOfRejectedMatches = function () {

    let rejectedMatchCountQuery = `
SELECT count(1)
FROM anagram_matches
WHERE rejected = true
`;
    return pools.anagramPool.query(rejectedMatchCountQuery).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getDateLastMatchCreated = function () {
    let dateLastMatchCreatedQuery = `
SELECT date_created
FROM anagram_matches
ORDER BY date_created DESC
LIMIT 1;
`;
    return pools.anagramPool.query(dateLastMatchCreatedQuery).then(x => {
        return x.rows[0].date_created;
    });
};

exports.getCountOfAnagramMatchesWithTweetInThisMatchAlreadyRetweeted = function(matchId) {
    let countOfMatchesWithTweetAlreadyRetweetedQuery = `
WITH candidateTweets AS (SELECT
                           t1.id tweet1id,
                           t2.id tweet2id
                         FROM anagram_matches
                           INNER JOIN tweets t1 ON anagram_matches.tweet1_id = t1.id
                           INNER JOIN tweets t2 ON anagram_matches.tweet2_id = t2.id
                         WHERE anagram_matches.id = $1::int),
    candidateTweetIds AS (SELECT tweet1Id AS id
                          FROM candidateTweets
                          UNION
                          SELECT tweet2Id AS id
                          FROM candidateTweets)
SELECT count(1)
FROM anagram_matches
WHERE anagram_matches.id != $1::int AND anagram_matches.date_retweeted IS NOT NULL AND
      (anagram_matches.tweet1_id IN (SELECT id
                                     FROM candidateTweetIds) OR
       anagram_matches.tweet2_id IN (SELECT id
                                     FROM candidateTweetIds))
`;

    return pools.anagramPool.query(countOfMatchesWithTweetAlreadyRetweetedQuery, [matchId]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getRetweetedStatusIds = function() {
    let retweetedStatusIdsQuery = `
SELECT
  anagram_matches.id,
  t1.status_id AS t1_status_id,
  t2.status_id AS t2_status_id
FROM anagram_matches
  INNER JOIN tweets t1 ON anagram_matches.tweet1_id = t1.id
  INNER JOIN tweets t2 ON anagram_matches.tweet2_id = t2.id
WHERE anagram_matches.date_retweeted IS NOT NULL
`;

    return pools.anagramPool.query(retweetedStatusIdsQuery).then(x => {
        return x.rows;
    });
};

exports.getTweetsToPostToTumblr = function(limit) {
    let retweetedAndNotUnretweetedAndNotPostedToTumblrQuery = `
SELECT
  anagram_matches.id,
  t1.status_id AS t1_status_id,
  t2.status_id AS t2_status_id
FROM anagram_matches
  INNER JOIN tweets t1 ON anagram_matches.tweet1_id = t1.id
  INNER JOIN tweets t2 ON anagram_matches.tweet2_id = t2.id
WHERE anagram_matches.date_retweeted IS NOT NULL
      AND anagram_matches.date_unretweeted IS NULL
      AND anagram_matches.date_posted_tumblr IS NULL
ORDER BY anagram_matches.date_retweeted
LIMIT $1::int
`;

    return pools.anagramPool.query(retweetedAndNotUnretweetedAndNotPostedToTumblrQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.setUnretweeted = function(matchId) {
    let setUnretweetedDate = `
UPDATE anagram_matches
SET date_unretweeted = current_timestamp
WHERE id = $1::int
`;

    return pools.anagramPool.query(setUnretweetedDate, [matchId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.setUnretweetedAndClearRetweetIds = function(matchId, clearTumblrPostId) {
    let setUnretweetedDateAndRetweetIds = `
UPDATE anagram_matches
SET date_unretweeted = current_timestamp,
  date_retweeted     = NULL,
  tweet1_retweet_id  = NULL,
  tweet2_retweet_id  = NULL
WHERE id = $1::int
`;

    let setUnretweetedDateRetweetIdsTumblrPostId = `
UPDATE anagram_matches
SET date_unretweeted = current_timestamp,
  date_retweeted     = NULL,
  tweet1_retweet_id  = NULL,
  tweet2_retweet_id  = NULL,
  tumblr_post_id     = NULL
WHERE id = $1::int
`;

    var queryToUseForUnretweeting;
    if (clearTumblrPostId) {
        queryToUseForUnretweeting = setUnretweetedDateRetweetIdsTumblrPostId;
    } else {
        queryToUseForUnretweeting = setUnretweetedDateAndRetweetIds;
    }

    return pools.anagramPool.query(queryToUseForUnretweeting, [matchId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.getMostRecentRetweetedMatches = function (limit = 10) {
    let getRecentRetweetedMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  anagram_matches.date_retweeted,
  tweet1.original_text               AS t1_originaltext,
  tweet2.original_text               AS t2_originaltext,
  tweet1.user_name                   AS t1_username,
  tweet1.status_id                   AS t1_statusid,
  tweet2.user_name                   AS t2_username,
  tweet2.status_id                   AS t2_statusid
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.ID
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.ID
WHERE anagram_matches.date_retweeted IS NOT NULL
ORDER BY anagram_matches.date_retweeted DESC
LIMIT $1::int;
`;

    return pools.anagramPool.query(getRecentRetweetedMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.getMostRecentRejectedMatches = function (limit = 10) {
    let getRecentRejectedMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  anagram_matches.date_retweeted,
  tweet1.original_text               AS t1_originaltext,
  tweet2.original_text               AS t2_originaltext,
  tweet1.user_name                   AS t1_username,
  tweet1.status_id                   AS t1_statusid,
  tweet2.user_name                   AS t2_username,
  tweet2.status_id                   AS t2_statusid
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.ID
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.ID
WHERE date_rejected IS NOT NULL
      AND anagram_matches.rejected = TRUE
      AND anagram_matches.tweet1_retweet_id IS NULL
      AND anagram_matches.tweet2_retweet_id IS NULL
ORDER BY date_rejected DESC
LIMIT $1::int;
`;

    return pools.anagramPool.query(getRecentRejectedMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.getOldestUnreviewedTweets = function(limit = 20) {
    let oldestUnreviewedTweetsQuery = `
WITH unreviewedMatchTweetIds AS (SELECT
                                   anagram_matches.tweet1_id,
                                   anagram_matches.tweet2_id
                                 FROM anagram_matches
                                 WHERE anagram_matches.attempted_approval = FALSE
                                       AND anagram_matches.date_retweeted IS NULL
                                       AND anagram_matches.date_posted_tumblr IS NULL),
    unreviewedTweetIds AS (SELECT tweet1_id AS id
                           FROM unreviewedMatchTweetIds
                           UNION
                           SELECT tweet2_id AS id
                           FROM unreviewedMatchTweetIds)
SELECT *
FROM tweets
WHERE tweets.id NOT IN (SELECT id
                        FROM unreviewedTweetIds)
ORDER BY date_existence_last_checked
LIMIT $1::int;
`;
    return pools.anagramPool.query(oldestUnreviewedTweetsQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.updateTweetsExistenceChecked = function(tweetIds) {

    if (tweetIds.length == 0) {
        return Promise.resolve(0);
    }

    let updateExistenceCheckedQuery = `
UPDATE tweets
SET date_existence_last_checked = current_timestamp
WHERE id = ANY($1)
`;

    return pools.anagramPool.query(updateExistenceCheckedQuery, [tweetIds]).then(x => {
        if (x.rowCount != tweetIds.length) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.deleteMatchesWithTweetIds = function(tweetIds) {

    if (tweetIds.length == 0) {
        return Promise.resolve(0);
    }

    let deleteMatchesQuery = `
DELETE FROM anagram_matches WHERE tweet1_id = ANY($1) OR tweet2_id = ANY($1);
`;

    return pools.anagramPool.query(deleteMatchesQuery, [tweetIds]).then(x => {
        return x;
    });
};

exports.deleteTweets = function(tweetIds) {

    if (tweetIds.length == 0) {
        return Promise.resolve(0);
    }

    let deleteTweetsQuery = `
DELETE FROM tweets WHERE id = ANY($1);
`;

    return pools.anagramPool.query(deleteTweetsQuery, [tweetIds]).then(x => {
        if (x.rowCount != tweetIds.length) {
            throw x;
        } else {
            return x;
        }
    });
};

function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

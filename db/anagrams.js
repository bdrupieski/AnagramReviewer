var pools = require('./poolProvider');

let maxMatchLimit = 50;
let defaultInterestingFactor = 0.75;
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
WHERE NOT A.rejected AND
      A.DATE_RETWEETED IS NULL
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
WHERE NOT A.rejected AND
      A.DATE_RETWEETED IS NULL AND
      A.interesting_factor > $2::float
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
WHERE NOT A.rejected AND
      A.date_retweeted IS NULL
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

exports.rejectMatch = function (matchId) {

    let rejectMatchQuery = `
UPDATE anagram_matches
SET rejected = TRUE
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(rejectMatchQuery, [matchId]).then(x => {
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

function getTweet(id) {
    let selectTweetQuery = `
SELECT *
FROM tweets
WHERE id = $1::uuid
LIMIT 1
`;
    return pools.anagramPool.query(selectTweetQuery, [id]).then(x => {
        return x.rows[0];
    });
}

exports.getAnagramMatch = function(id) {
    let selectAnagramMatchQuery = `
SELECT *
FROM anagram_matches
WHERE id = $1::int
LIMIT 1
`;
    return pools.anagramPool.query(selectAnagramMatchQuery, [id]).then(x => {
        return x.rows[0];
    });
}

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

exports.getMatchesCreatedPerDay = function (numberOfPastDays = 30) {

    numberOfPastDays = Math.max(numberOfPastDays, 5);

    let selectMatchesCreatedPerDayQuery = `
SELECT
  date_trunc('day', anagram_matches.date_created) AS day,
  SUM(1)                                          AS sum
FROM anagram_matches
GROUP BY day
ORDER BY day DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(selectMatchesCreatedPerDayQuery, [numberOfPastDays]).then(x => {
        return x.rows;
    });
};

exports.getCountOfAnagramMatches = function () {
    let selectAnagramMatchCount = `
SELECT count(1)
FROM anagram_matches;
`;
    return pools.anagramPool.query(selectAnagramMatchCount).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getApproximateCountOfTweets = function () {
    let selectApproximateTweetCount = `
SELECT reltuples AS approximate_row_count FROM pg_class WHERE relname = 'tweets' LIMIT 1;
`;
    return pools.anagramPool.query(selectApproximateTweetCount).then(x => {
        return Number(x.rows[0].approximate_row_count);
    });
};

exports.getCountOfMatchesWithInterestingFactorGreaterThan = function (interestingFactorCutoff = defaultInterestingFactor) {

    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    let selectAnagramMatchCount = `
SELECT count(1)
FROM anagram_matches
WHERE interesting_factor > $1::float;
`;
    return pools.anagramPool.query(selectAnagramMatchCount, [interestingFactorCutoff]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getCountOfNotRejectedAndNotApprovedMatchesWithInterestingFactorGreaterThan = function (interestingFactorCutoff = defaultInterestingFactor) {

    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    let selectNotRejectedAndNotApprovedAnagramMatchCount = `
SELECT count(1)
FROM anagram_matches
WHERE interesting_factor > $1::float 
      AND rejected = false      
      AND anagram_matches.date_retweeted IS NULL;
`;
    return pools.anagramPool.query(selectNotRejectedAndNotApprovedAnagramMatchCount, [interestingFactorCutoff]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getCountOfRetweetedMatches = function () {

    let selectRetweetedMatchCount = `
SELECT count(1)
FROM anagram_matches
WHERE date_retweeted IS NOT NULL
`;
    return pools.anagramPool.query(selectRetweetedMatchCount).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getCountOfRejectedMatches = function () {

    let selectedRejectedMatchCount = `
SELECT count(1)
FROM anagram_matches
WHERE rejected = true
`;
    return pools.anagramPool.query(selectedRejectedMatchCount).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getDateLastMatchCreated = function () {
    let selectDateLastMatchCreated = `
SELECT date_created
FROM anagram_matches
ORDER BY date_created DESC
LIMIT 1;
`;
    return pools.anagramPool.query(selectDateLastMatchCreated).then(x => {
        return x.rows[0].date_created;
    });
};

exports.getCountOfAnagramMatchesWithTweetInThisMatchAlreadyRetweeted = function(matchId) {
    let countOfMatchesWithTweetAlreadyRetweeted = `
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

    return pools.anagramPool.query(countOfMatchesWithTweetAlreadyRetweeted, [matchId]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getRetweetedStatusIds = function() {
    let retweetedStatusIds = `
SELECT
  anagram_matches.id,
  t1.status_id AS t1_status_id,
  t2.status_id AS t2_status_id
FROM anagram_matches
  INNER JOIN tweets t1 ON anagram_matches.tweet1_id = t1.id
  INNER JOIN tweets t2 ON anagram_matches.tweet2_id = t2.id
WHERE anagram_matches.date_retweeted IS NOT NULL
`;

    return pools.anagramPool.query(retweetedStatusIds).then(x => {
        return x.rows;
    });
};

exports.setUnretweeted = function(matchId) {
    let setUnretweetedDate = `
UPDATE anagram_matches
SET date_unretweeted = current_timestamp
WHERE id = $1
`;

    return pools.anagramPool.query(setUnretweetedDate, [matchId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

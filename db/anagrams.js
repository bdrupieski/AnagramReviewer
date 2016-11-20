const pools = require('./poolProvider');

const maxMatchLimit = 50;
const defaultInterestingFactor = 0.67;
const topMatchesQueryType = "topmatches";
const oldestTopMatchesQueryType = "oldesttopmatches";
const mostRecentMatches = "mostrecentmatches";
const queuedMatchPendingStatus = 'pending';
const queuedMatchErrorStatus = 'error';
const queuedMatchErrorObservedStatus = 'error_ok';
const queuedMatchPostedStatus = 'posted';
const queuedMatchRemovedStatus = 'removed';

const topMatchQueryTypes = [topMatchesQueryType, oldestTopMatchesQueryType, mostRecentMatches];

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

    const topMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.user_name                   AS t1_username,
  tweet1.status_id                   AS t1_statusId,
  tweet2.user_name                   AS t2_username,
  tweet2.status_id                   AS t2_statusId
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE NOT anagram_matches.rejected
      AND anagram_matches.date_retweeted IS NULL
      AND anagram_matches.tumblr_post_id IS NULL
      AND anagram_matches.id NOT IN (SELECT match_id
                                     FROM match_queue
                                     WHERE status = '${queuedMatchPendingStatus}')
ORDER BY
  anagram_matches.interesting_factor DESC
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

    const oldestTopMatchQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.user_name                   AS t1_username,
  tweet1.status_id                   AS t1_statusId,
  tweet2.user_name                   AS t2_username,
  tweet2.status_id                   AS t2_statusId
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE NOT anagram_matches.rejected
      AND anagram_matches.date_retweeted IS NULL
      AND anagram_matches.tumblr_post_id IS NULL
      AND anagram_matches.interesting_factor > $2::float
      AND anagram_matches.id NOT IN (SELECT match_id
                                     FROM match_queue
                                     WHERE status = '${queuedMatchPendingStatus}')
ORDER BY
  anagram_matches.date_created
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

    const topMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.user_name                   AS t1_username,
  tweet1.status_id                   AS t1_statusId,
  tweet2.user_name                   AS t2_username,
  tweet2.status_id                   AS t2_statusId
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE NOT anagram_matches.rejected
      AND anagram_matches.date_retweeted IS NULL
      AND anagram_matches.tumblr_post_id IS NULL
      AND anagram_matches.id NOT IN (SELECT match_id
                                     FROM match_queue
                                     WHERE status = '${queuedMatchPendingStatus}')
ORDER BY
  anagram_matches.date_created DESC
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

    const rejectMatchQuery = `
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

    const unrejectMatchQuery = `
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

    const markApprovalAttemptedQuery = `
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

    const approveMatchQuery = `
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
    const updateTumblrPostIdQuery = `
UPDATE anagram_matches
SET
  tumblr_post_id     = $2::bigint,
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
    const tweetByIdQuery = `
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
    const anagramMatchByIdQuery = `
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

    const statsByDateMatchCreated = `
SELECT
  DISTINCT ON (day)
  date(anagram_matches.date_created) AS day,
  count(1) OVER w AS matches_created,
  sum(CASE WHEN anagram_matches.attempted_approval = true THEN 1 ELSE 0 END) OVER w AS attempted_approval,
  sum(CASE WHEN anagram_matches.auto_rejected = true THEN 1 ELSE 0 END) OVER w AS auto_rejected,
  count(anagram_matches.date_retweeted) OVER w AS retweeted,
  count(anagram_matches.date_unretweeted) OVER w AS unretweeted,
  sum(CASE WHEN anagram_matches.rejected = true THEN 1 ELSE 0 END) OVER w AS rejected,
  count(anagram_matches.date_posted_tumblr) OVER w AS posted_to_tumblr,
  sum(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false THEN 1 ELSE 0 END) OVER w AS unreviewed,
  avg(anagram_matches.interesting_factor) over w as average_interesting_factor,
  avg(CASE WHEN anagram_matches.attempted_approval = true THEN anagram_matches.interesting_factor END) over w as attempted_approval_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = true THEN anagram_matches.interesting_factor END) over w as rejected_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false THEN anagram_matches.interesting_factor END) over w as unreviewed_average_interesting_factor
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

    const statsByInterestingFactorBucket = `
SELECT
  DISTINCT ON (score)
  trunc(anagram_matches.interesting_factor :: NUMERIC, 2) AS score,
  count(1) OVER w AS matches_created,
  sum(CASE WHEN anagram_matches.attempted_approval = true THEN 1 ELSE 0 END) OVER w AS attempted_approval,
  sum(CASE WHEN anagram_matches.auto_rejected = true THEN 1 ELSE 0 END) OVER w AS auto_rejected,
  count(anagram_matches.date_retweeted) OVER w AS retweeted,
  count(anagram_matches.date_unretweeted) OVER w AS unretweeted,
  sum(CASE WHEN anagram_matches.rejected = true THEN 1 ELSE 0 END) OVER w AS rejected,
  count(anagram_matches.date_posted_tumblr) OVER w AS posted_to_tumblr,
  sum(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false THEN 1 ELSE 0 END) OVER w AS unreviewed
FROM anagram_matches
WINDOW w AS (
  PARTITION BY trunc(anagram_matches.interesting_factor :: NUMERIC, 2) )
ORDER BY score DESC;
`;
    return pools.anagramPool.query(statsByInterestingFactorBucket).then(x => {
        return x.rows;
    });
};

exports.getStatsByTimeOfDayMatchCreated = function(minuteInterval = 5) {

    const interval = clamp(minuteInterval, 1, 60);

    const statsByDateMatchCreatedTimeOfDayQuery = `
SELECT
  DISTINCT ON (time_of_day)
  date_part('hour', anagram_matches.date_created) * INTERVAL '1 hour' +
  (date_part('minute', anagram_matches.date_created) :: INT / ${interval} * INTERVAL '${interval} min') AS time_of_day,
  count(1) OVER w AS matches_created,
  sum(CASE WHEN anagram_matches.attempted_approval = true THEN 1 ELSE 0 END) OVER w AS attempted_approval,
  sum(CASE WHEN anagram_matches.auto_rejected = true THEN 1 ELSE 0 END) OVER w AS auto_rejected,
  count(anagram_matches.date_retweeted) OVER w AS retweeted,
  count(anagram_matches.date_unretweeted) OVER w AS unretweeted,
  sum(CASE WHEN anagram_matches.rejected = true THEN 1 ELSE 0 END) OVER w AS rejected,
  count(anagram_matches.date_posted_tumblr) OVER w AS posted_to_tumblr,
  sum(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false THEN 1 ELSE 0 END) OVER w AS unreviewed,
  avg(anagram_matches.interesting_factor) over w as average_interesting_factor,
  avg(CASE WHEN anagram_matches.attempted_approval = true THEN anagram_matches.interesting_factor END) over w as attempted_approval_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = true THEN anagram_matches.interesting_factor END) over w as rejected_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false THEN anagram_matches.interesting_factor END) over w as unreviewed_average_interesting_factor
FROM anagram_matches
WINDOW w AS (
  PARTITION BY date_part('hour', anagram_matches.date_created) * INTERVAL '1 hour' +
               (date_part('minute', anagram_matches.date_created) :: INT / ${interval} * INTERVAL '${interval} min') )
ORDER BY time_of_day;
`;
    return pools.anagramPool.query(statsByDateMatchCreatedTimeOfDayQuery).then(x => {
        return x.rows;
    });
};

exports.getRetweetsAndTumblrPostsByDay = function (numberOfPastDays = 30) {

    numberOfPastDays = Math.max(numberOfPastDays, 5);

    const retweetsAndTumblrPostsByDayQuery = `
SELECT
  COALESCE(retweeted.day, tumblr.day)               AS day,
  COALESCE(count_retweeted, 0)                      AS retweeted,
  COALESCE(count_posted_tumblr, 0)                  AS posted_to_tumblr,
  COALESCE(average_interesting_factor_retweeted, 0) AS average_interesting_factor_retweeted,
  COALESCE(average_interesting_factor_tumblr, 0)    AS average_interesting_factor_tumblr
FROM (SELECT
        date(anagram_matches.date_retweeted)    AS day,
        count(1)                                AS count_retweeted,
        avg(anagram_matches.interesting_factor) AS average_interesting_factor_retweeted
      FROM anagram_matches
      WHERE date(date_retweeted) > current_date - interval '${numberOfPastDays}' day
      GROUP BY day) AS retweeted
  FULL OUTER JOIN (SELECT
                     date(anagram_matches.date_posted_tumblr) AS day,
                     count(1)                                 AS count_posted_tumblr,
                     avg(anagram_matches.interesting_factor)  AS average_interesting_factor_tumblr
                   FROM anagram_matches
                   WHERE date(date_posted_tumblr) > current_date - interval '${numberOfPastDays}' day 
                   GROUP BY day) AS tumblr ON retweeted.day = tumblr.day
ORDER BY day DESC
`;
    return pools.anagramPool.query(retweetsAndTumblrPostsByDayQuery).then(x => {
        return x.rows;
    });
};

exports.getCountOfAnagramMatches = function () {
    const anagramMatchCountQuery = `
SELECT count(1)
FROM anagram_matches;
`;
    return pools.anagramPool.query(anagramMatchCountQuery).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getApproximateCountOfTweets = function () {
    const approximateTweetCountQuery = `
SELECT reltuples AS approximate_row_count FROM pg_class WHERE relname = 'tweets' LIMIT 1;
`;
    return pools.anagramPool.query(approximateTweetCountQuery).then(x => {
        return Number(x.rows[0].approximate_row_count);
    });
};

exports.getCountOfMatchesWithInterestingFactorGreaterThan = function (interestingFactorCutoff = defaultInterestingFactor) {

    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    const anagramMatchCountQuery = `
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

    const notRejectedAndNotApprovedAnagramMatchCountQuery = `
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

    const retweetedMatchCountQuery = `
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

    const rejectedMatchCountQuery = `
SELECT count(1)
FROM anagram_matches
WHERE rejected = true
`;
    return pools.anagramPool.query(rejectedMatchCountQuery).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getDateLastMatchCreated = function () {
    const dateLastMatchCreatedQuery = `
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
    const countOfMatchesWithTweetAlreadyRetweetedQuery = `
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
    const retweetedStatusIdsQuery = `
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
    const retweetedAndNotUnretweetedAndNotPostedToTumblrQuery = `
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
    const setUnretweetedDate = `
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
    const setUnretweetedDateAndRetweetIds = `
UPDATE anagram_matches
SET 
  date_unretweeted   = current_timestamp,
  date_retweeted     = NULL,
  tweet1_retweet_id  = NULL,
  tweet2_retweet_id  = NULL
WHERE id = $1::int
`;

    const setUnretweetedDateRetweetIdsTumblrPostId = `
UPDATE anagram_matches
SET 
  date_unretweeted   = current_timestamp,
  date_retweeted     = NULL,
  tweet1_retweet_id  = NULL,
  tweet2_retweet_id  = NULL,
  tumblr_post_id     = NULL
WHERE id = $1::int
`;

    let queryToUseForUnretweeting;
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
    const getRecentRetweetedMatchesQuery = `
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
    const getRecentRejectedMatchesQuery = `
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
    const oldestUnreviewedTweetsQuery = `
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

    const updateExistenceCheckedQuery = `
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

    const deleteMatchesQuery = `
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

    const deleteTweetsQuery = `
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

exports.enqueueMatch = function(matchId, orderAsShown) {
    const enqueueMatchQuery = `
INSERT INTO match_queue (match_id, order_as_shown) VALUES ($1::int, $2::bool)
`;
    return pools.anagramPool.query(enqueueMatchQuery, [matchId, orderAsShown]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.getPendingQueuedCountForMatch = function(matchId) {
    const pendingQueuedMatchCountQuery = `
SELECT count(1)
FROM match_queue
WHERE
  status = '${queuedMatchPendingStatus}'
  AND match_id = $1::int
`;
    return pools.anagramPool.query(pendingQueuedMatchCountQuery, [matchId]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getNextPendingQueuedMatchToDequeue = function () {
    const pendingQueuedMatchQuery = `
SELECT
  match_queue.id       AS match_queue_id,
  match_queue.match_id AS match_id,
  match_queue.order_as_shown,
  anagram_matches.tweet1_id,
  anagram_matches.tweet2_id
FROM match_queue
  INNER JOIN anagram_matches ON match_queue.match_id = anagram_matches.id
WHERE match_queue.status = '${queuedMatchPendingStatus}'
      AND match_queue.match_id NOT IN (SELECT match_id
                                       FROM match_queue
                                       WHERE status = '${queuedMatchPendingStatus}'
                                       GROUP BY match_id
                                       HAVING count(1) > 1)
ORDER BY date_queued
LIMIT 1
`;
    return pools.anagramPool.query(pendingQueuedMatchQuery).then(x => {
        return x.rows;
    });
};

exports.updateQueuedMatchAsPosted = function (queuedMatchId) {
    const updateQueuedMatchAsPostedQuery = `
UPDATE match_queue
SET 
  date_posted = current_timestamp,
  status      = '${queuedMatchPostedStatus}'
WHERE id = $1::int
`;

    return pools.anagramPool.query(updateQueuedMatchAsPostedQuery, [queuedMatchId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.updateQueuedMatchAsError = function (queuedMatchId, error) {
    const updateQueuedMatchAsErrorQuery = `
UPDATE match_queue
SET 
  status     = '${queuedMatchErrorStatus}',
  message    = $2,
  date_error = current_timestamp
WHERE id = $1::int
`;

    return pools.anagramPool.query(updateQueuedMatchAsErrorQuery, [queuedMatchId, error]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

function updateQueuedMatchWithStatus(queuedMatchId, status) {
    const updateQueuedMatchWithStatusQuery = `
UPDATE match_queue
SET status = $2::text
WHERE id = $1::int
`;

    return pools.anagramPool.query(updateQueuedMatchWithStatusQuery, [queuedMatchId, status]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
}

exports.updateQueuedMatchAsRemoved = function (queuedMatchId) {
    return updateQueuedMatchWithStatus(queuedMatchId, queuedMatchRemovedStatus);
};

exports.updateQueuedMatchAsErrorObserved = function (queuedMatchId) {
    return updateQueuedMatchWithStatus(queuedMatchId, queuedMatchErrorObservedStatus);
};

function getCountOfQueuedMatchesWithStatus(status) {
    const queuedMatchCountQuery = `
SELECT count(1)
FROM match_queue
WHERE status = $1::text
`;
    return pools.anagramPool.query(queuedMatchCountQuery, [status]).then(x => {
        return Number(x.rows[0].count);
    });
}

exports.getCountOfPendingQueuedMatches = function() {
    return getCountOfQueuedMatchesWithStatus(queuedMatchPendingStatus);
};

exports.getCountOfErrorQueuedMatches = function() {
    return getCountOfQueuedMatchesWithStatus(queuedMatchErrorStatus);
};

exports.getCountOfObservedErrorQueuedMatches = function() {
    return getCountOfQueuedMatchesWithStatus(queuedMatchErrorObservedStatus);
};

exports.getCountOfPostedQueueMatches = function() {
    return getCountOfQueuedMatchesWithStatus(queuedMatchPostedStatus);
};

exports.getCountOfRemovedQueueMatches = function() {
    return getCountOfQueuedMatchesWithStatus(queuedMatchRemovedStatus);
};

function getQueuedMatchesWithStatus(status) {
    const queuedMatchesWithStatusQuery = `
SELECT
  match_queue.id,
  match_queue.date_queued,
  match_queue.date_error,
  match_queue.message,
  anagram_matches.id                 AS match_id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.user_name                   AS t1_username,
  tweet1.status_id                   AS t1_statusId,
  tweet2.user_name                   AS t2_username,
  tweet2.status_id                   AS t2_statusId
FROM
  match_queue
  INNER JOIN anagram_matches ON anagram_matches.id = match_queue.match_id
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE match_queue.status = '${status}'
ORDER BY match_queue.date_queued;
`;

    return pools.anagramPool.query(queuedMatchesWithStatusQuery).then(x => {
        return x.rows;
    });
}

exports.getErrorQueuedMatches = function() {
    return getQueuedMatchesWithStatus(queuedMatchErrorStatus);
};

exports.getPendingQueuedMatches = function() {
    return getQueuedMatchesWithStatus(queuedMatchPendingStatus);
};

function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

const pools = require('./poolProvider');
const matchQueue = require("./matchQueue");

const maxMatchLimit = 50;
const defaultInterestingFactor = 0.50;
const topMatchesQueryType = "topmatches";
const oldestTopMatchesQueryType = "oldesttopmatches";
const mostRecentMatches = "mostrecentmatches";

const topMatchQueryTypes = [topMatchesQueryType, oldestTopMatchesQueryType, mostRecentMatches];

exports.defaultInterestingFactor = defaultInterestingFactor;

exports.findMatches = function (topMatchQueryType, limit = maxMatchLimit, interestingFactorCutoff = defaultInterestingFactor) {

    if (!topMatchQueryTypes.includes(topMatchQueryType)) {
        throw `topMatchQueryType ${topMatchQueryType} is invalid`;
    }

    limit = Math.min(limit, maxMatchLimit);
    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    if (topMatchQueryType == topMatchesQueryType) {
        return findUnreviewedTopMatches(limit);
    } else if (topMatchQueryType == oldestTopMatchesQueryType) {
        return findOldestUnreviewedTopMatches(limit, interestingFactorCutoff);
    } else if (topMatchQueryType == mostRecentMatches) {
        return findMostRecentUnreviewedMatches(limit);
    } else {
        throw `${topMatchQueryType} is invalid in a really weird way`;
    }
};

function findUnreviewedTopMatches(limit) {

    const topUnreviewedMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id,
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
      AND anagram_matches.date_unretweeted IS NULL
      AND anagram_matches.tumblr_post_id IS NULL
      AND anagram_matches.id NOT IN (SELECT match_id
                                     FROM match_queue
                                     WHERE status = '${matchQueue.queuedMatchPendingStatus}')
ORDER BY
  anagram_matches.interesting_factor DESC
limit $1::int;
`;

    return pools.anagramPool.query(topUnreviewedMatchesQuery, [limit]).then(x => {
        if (!x.rows) {
            throw x;
        } else {
            return x.rows;
        }
    });
}

function findOldestUnreviewedTopMatches(limit, interestingFactorCutoff = defaultInterestingFactor) {

    const oldestUnreviewedTopMatchQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id,
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
      AND anagram_matches.date_unretweeted IS NULL
      AND anagram_matches.tumblr_post_id IS NULL
      AND anagram_matches.interesting_factor > $2::float
      AND anagram_matches.id NOT IN (SELECT match_id
                                     FROM match_queue
                                     WHERE status = '${matchQueue.queuedMatchPendingStatus}')
ORDER BY
  anagram_matches.date_created
LIMIT $1::int;
`;

    return pools.anagramPool.query(oldestUnreviewedTopMatchQuery, [limit, interestingFactorCutoff]).then(x => {
        if (!x.rows) {
            throw x;
        } else {
            return x.rows;
        }
    });
}

function findMostRecentUnreviewedMatches(limit) {

    const mostRecentUnreviewedMatchQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id,
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
      AND anagram_matches.date_unretweeted IS NULL
      AND anagram_matches.tumblr_post_id IS NULL
      AND anagram_matches.id NOT IN (SELECT match_id
                                     FROM match_queue
                                     WHERE status = '${matchQueue.queuedMatchPendingStatus}')
ORDER BY
  anagram_matches.date_created DESC
LIMIT $1::int;
`;

    return pools.anagramPool.query(mostRecentUnreviewedMatchQuery, [limit]).then(x => {
        if (!x.rows) {
            throw x;
        } else {
            return x.rows;
        }
    });
}

exports.rejectMatch = function (matchId, isAutoRejected = false) {

    const explicitlyRejectQuery = `
UPDATE anagram_matches
SET 
  rejected           = TRUE,
  date_rejected      = current_timestamp,
  auto_rejected      = $2::boolean,
  attempted_approval = FALSE
WHERE anagram_matches.id = $1::int;
`;

    const autoRejectQuery = `
UPDATE anagram_matches
SET 
  rejected           = TRUE,
  date_rejected      = current_timestamp,
  auto_rejected      = $2::boolean
WHERE anagram_matches.id = $1::int;
`;
    const query = isAutoRejected ? autoRejectQuery : explicitlyRejectQuery;

    return pools.anagramPool.query(query, [matchId, isAutoRejected]).then(x => {
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

exports.updateMatchAsRetweeted = function (matchId, tweet1RetweetId, tweet2RetweetId, postedInOrder) {

    const updateMatchAsRetweetedQuery = `
UPDATE anagram_matches
SET
  tweet1_retweet_id = $2,
  tweet2_retweet_id = $3,
  date_retweeted    = current_timestamp,
  date_unretweeted  = NULL,
  posted_in_order   = $4::boolean
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(updateMatchAsRetweetedQuery, [matchId, tweet1RetweetId, tweet2RetweetId, postedInOrder]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.updateTumblrPostId = function(matchId, tumblrPostId, postedInOrder) {
    const updateTumblrPostIdQuery = `
UPDATE anagram_matches
SET
  tumblr_post_id        = $2::bigint,
  date_posted_tumblr    = current_timestamp,
  date_unposted_tumblr  = NULL,
  posted_in_order       = $3::boolean
WHERE anagram_matches.id = $1::int;
`;

    return pools.anagramPool.query(updateTumblrPostIdQuery, [matchId, tumblrPostId, postedInOrder]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

function getTweet(tweetId) {
    const tweetByIdQuery = `
SELECT *
FROM tweets
WHERE id = $1::uuid
LIMIT 1;
`;
    return pools.anagramPool.query(tweetByIdQuery, [tweetId]).then(x => {
        return x.rows[0];
    });
}

exports.getTweet = getTweet;

exports.getAnagramMatch = function(id) {
    const anagramMatchByIdQuery = `
SELECT *
FROM anagram_matches
WHERE id = $1::int
LIMIT 1;
`;
    return pools.anagramPool.query(anagramMatchByIdQuery, [id]).then(x => {
        return x.rows[0];
    });
};

exports.getAnagramMatchWithTweetInfo = function(id) {
    const anagramMatchWithTweetInfoByIdQuery = `
WITH otherMatchCountForTweet1 AS (SELECT
                                    count(1)        AS count,
                                    sum(CASE WHEN anagram_matches.attempted_approval IS TRUE
                                      THEN 1
                                        ELSE 0 END) AS attempted_approval_count,
                                    sum(CASE WHEN anagram_matches.date_retweeted IS NOT NULL AND
                                                  anagram_matches.date_unretweeted IS NULL
                                      THEN 1
                                        ELSE 0 END) AS retweeted_count,
                                    sum(CASE WHEN anagram_matches.date_posted_tumblr IS NOT NULL AND
                                                  anagram_matches.date_unposted_tumblr IS NULL
                                      THEN 1
                                        ELSE 0 END) AS tumblr_count,
                                    $1::int         AS id
                                  FROM anagram_matches
                                  WHERE id != $1::int AND
                                        (tweet1_id IN (SELECT tweet1_id
                                                       FROM anagram_matches
                                                       WHERE id = $1::int)
                                         OR
                                         tweet2_id IN (SELECT tweet1_id
                                                       FROM anagram_matches
                                                       WHERE id = $1::int))),
    otherMatchCountForTweet2 AS (SELECT
                                   count(1)        AS count,
                                   sum(CASE WHEN anagram_matches.attempted_approval IS TRUE
                                     THEN 1
                                       ELSE 0 END) AS attempted_approval_count,
                                   sum(CASE WHEN anagram_matches.date_retweeted IS NOT NULL AND
                                                 anagram_matches.date_unretweeted IS NULL
                                     THEN 1
                                       ELSE 0 END) AS retweeted_count,
                                   sum(CASE WHEN anagram_matches.date_posted_tumblr IS NOT NULL AND
                                                 anagram_matches.date_unposted_tumblr IS NULL
                                     THEN 1
                                       ELSE 0 END) AS tumblr_count,
                                   $1::int         AS id
                                 FROM anagram_matches
                                 WHERE id != $1::int AND
                                        (tweet1_id IN (SELECT tweet2_id
                                                       FROM anagram_matches
                                                       WHERE id = $1::int)
                                         OR
                                         tweet2_id IN (SELECT tweet2_id
                                                       FROM anagram_matches
                                                       WHERE id = $1::int)))
SELECT
  t1.id                                                          AS t1_id,
  t2.id                                                          AS t2_id,
  t1.original_text                                               AS t1_original_text,
  t2.original_text                                               AS t2_original_text,
  otherMatchCountForTweet1.count                                 AS t1_other_match_count,
  COALESCE(otherMatchCountForTweet1.attempted_approval_count, 0) AS t1_other_match_attempted_approval_count,
  COALESCE(otherMatchCountForTweet1.retweeted_count, 0)          AS t1_other_match_retweeted_count,
  COALESCE(otherMatchCountForTweet1.tumblr_count, 0)             AS t1_other_match_tumblr_count_count,
  otherMatchCountForTweet2.count                                 AS t2_other_match_count,
  COALESCE(otherMatchCountForTweet2.attempted_approval_count, 0) AS t2_other_match_attempted_approval_count,
  COALESCE(otherMatchCountForTweet2.retweeted_count, 0)          AS t2_other_match_retweeted_count,
  COALESCE(otherMatchCountForTweet2.tumblr_count, 0)             AS t2_other_match_tumblr_count_count,
  t1.created_at                                                  AS t1_created_at,
  t2.created_at                                                  AS t2_created_at,
  t1.user_name                                                   AS t1_user_name,
  t2.user_name                                                   AS t2_user_name,
  t1.status_id                                                   AS t1_status_id,
  t2.status_id                                                   AS t2_status_id,
  t1.stripped_sorted_text,
  anagram_matches.*
FROM anagram_matches
  INNER JOIN tweets t1 ON t1.id = anagram_matches.tweet1_id
  INNER JOIN tweets t2 ON t2.id = anagram_matches.tweet2_id
  INNER JOIN otherMatchCountForTweet1 ON otherMatchCountForTweet1.id = anagram_matches.id
  INNER JOIN otherMatchCountForTweet2 ON otherMatchCountForTweet2.id = anagram_matches.id
WHERE anagram_matches.id = $1::int
LIMIT 1;
`;
    return pools.anagramPool.query(anagramMatchWithTweetInfoByIdQuery, [id]).then(x => {
        const fullMatch = x.rows[0];

        fullMatch.stripped_sorted_text_length = fullMatch.stripped_sorted_text.length;
        fullMatch.english_word_count = Math.trunc(fullMatch.english_words_to_total_word_count_ratio * fullMatch.total_words);
        fullMatch.interesting_factor_without_english_words =
            (fullMatch.edit_distance_to_length_ratio +
            fullMatch.different_word_count_to_total_word_count_ratio +
            fullMatch.inverse_lcs_length_to_total_length_ratio +
            fullMatch.total_length_to_highest_length_captured_ratio) / 4;
        fullMatch.interesting_factor_without_english_or_length =
            (fullMatch.edit_distance_to_length_ratio +
            fullMatch.different_word_count_to_total_word_count_ratio +
            fullMatch.inverse_lcs_length_to_total_length_ratio) / 3;

        return fullMatch;
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

    numberOfPastDays = Math.max(numberOfPastDays, 2);

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
  sum(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false AND anagram_matches.date_unretweeted IS NULL AND anagram_matches.date_unposted_tumblr IS NULL THEN 1 ELSE 0 END) OVER w AS unreviewed,
  avg(anagram_matches.interesting_factor) over w as average_interesting_factor,
  avg(CASE WHEN anagram_matches.attempted_approval = true THEN anagram_matches.interesting_factor END) over w as attempted_approval_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = true THEN anagram_matches.interesting_factor END) over w as rejected_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false AND anagram_matches.date_unretweeted IS NULL AND anagram_matches.date_unposted_tumblr IS NULL THEN anagram_matches.interesting_factor END) over w as unreviewed_average_interesting_factor
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

exports.getStatsByInterestingFactorBucket = function (numberOfPastDays) {

    numberOfPastDays = Number(numberOfPastDays);

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
  sum(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false AND anagram_matches.date_unretweeted IS NULL AND anagram_matches.date_unposted_tumblr IS NULL THEN 1 ELSE 0 END) OVER w AS unreviewed
FROM anagram_matches
WHERE date(anagram_matches.date_created) > current_date - INTERVAL '${numberOfPastDays}' DAY
WINDOW w AS (
  PARTITION BY trunc(anagram_matches.interesting_factor :: NUMERIC, 2) )
ORDER BY score DESC;
`;
    return pools.anagramPool.query(statsByInterestingFactorBucket).then(x => {
        return x.rows;
    });
};

exports.getStatsByTimeOfDayMatchCreated = function(minuteInterval = 5, numberOfPastDays) {

    const interval = clamp(minuteInterval, 1, 60);
    numberOfPastDays = Number(numberOfPastDays);

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
  sum(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false AND anagram_matches.date_unretweeted IS NULL AND anagram_matches.date_unposted_tumblr IS NULL THEN 1 ELSE 0 END) OVER w AS unreviewed,
  avg(anagram_matches.interesting_factor) over w as average_interesting_factor,
  avg(CASE WHEN anagram_matches.attempted_approval = true THEN anagram_matches.interesting_factor END) over w as attempted_approval_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = true THEN anagram_matches.interesting_factor END) over w as rejected_average_interesting_factor,
  avg(CASE WHEN anagram_matches.rejected = false AND anagram_matches.attempted_approval = false AND anagram_matches.date_unretweeted IS NULL AND anagram_matches.date_unposted_tumblr IS NULL THEN anagram_matches.interesting_factor END) over w as unreviewed_average_interesting_factor
FROM anagram_matches
WHERE date(anagram_matches.date_created) > current_date - INTERVAL '${numberOfPastDays}' DAY
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

    numberOfPastDays = Math.max(numberOfPastDays, 2);

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
ORDER BY day DESC;
`;
    return pools.anagramPool.query(retweetsAndTumblrPostsByDayQuery).then(x => {
        return x.rows;
    });
};

exports.getDaysSinceFirstMatch = function() {
    const daysSinceFirstMatchQuery = `
SELECT
  current_date - date(anagram_matches.date_created) AS days,
  anagram_matches.date_created                      AS first_match_created
FROM anagram_matches
ORDER BY anagram_matches.date_created
LIMIT 1;
`;
    return pools.anagramPool.query(daysSinceFirstMatchQuery).then(x => {
        const row = x.rows[0];
        return {
            days: Number(row.days),
            firstMatchCreated: new Date(row.first_match_created),
        }
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

exports.getExactCountOfTweets = function () {
    const exactTweetCountQuery = `
SELECT count(1) AS tweet_count FROM tweets;
`;
    return pools.anagramPool.query(exactTweetCountQuery).then(x => {
        return Number(x.rows[0].tweet_count);
    });
};

exports.getExactCountOfTweetsInPastNumberOfDays = function(pastNumberOfDays) {
    const exactCountOfTweetsInPastNumberOfDays = `
SELECT count(1) as tweet_count_in_past_number_of_days
FROM tweets
WHERE date(tweets.created_at) > current_date - INTERVAL '${pastNumberOfDays}' DAY;
`;
    return pools.anagramPool.query(exactCountOfTweetsInPastNumberOfDays).then(x => {
        return Number(x.rows[0].tweet_count_in_past_number_of_days);
    });
}

exports.getCountOfNotRejectedAndNotApprovedMatchesWithInterestingFactorGreaterThan = function (interestingFactorCutoff = defaultInterestingFactor) {

    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    const notRejectedAndNotApprovedAnagramMatchCountQuery = `
SELECT count(1)
FROM anagram_matches
  LEFT JOIN match_queue ON anagram_matches.id = match_queue.match_id
WHERE
  match_queue.id IS NULL
  AND anagram_matches.interesting_factor > $1::float
  AND anagram_matches.rejected = FALSE
  AND anagram_matches.date_retweeted IS NULL
  AND anagram_matches.date_unretweeted IS NULL
  AND anagram_matches.tumblr_post_id IS NULL;
`;
    return pools.anagramPool.query(notRejectedAndNotApprovedAnagramMatchCountQuery, [interestingFactorCutoff]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getAllTimeCounts = function(interestingFactorCutoff) {

    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    const allTimeCountsQuery = `
SELECT
  count(1)                                   total_count,
  sum(CASE WHEN anagram_matches.attempted_approval IS TRUE
    THEN 1
      ELSE 0 END)                         AS attempted_approval_count,
  sum(CASE WHEN anagram_matches.rejected IS TRUE
    THEN 1
      ELSE 0 END)                         AS rejected_count,
  sum(CASE WHEN anagram_matches.date_retweeted IS NOT NULL AND anagram_matches.date_unretweeted IS NULL
    THEN 1
      ELSE 0 END)                         AS retweet_count,
  sum(CASE WHEN anagram_matches.date_posted_tumblr IS NOT NULL AND
                (anagram_matches.date_retweeted IS NULL OR anagram_matches.date_unretweeted IS NOT NULL)
    THEN 1
      ELSE 0 END)                         AS tumblr_only_count,
  sum(CASE WHEN anagram_matches.interesting_factor > $1::float
    THEN 1
      ELSE 0 END)                         AS interesting_factor_count,
  sum(CASE WHEN anagram_matches.date_unretweeted IS NOT NULL AND
                (anagram_matches.date_retweeted IS NULL OR anagram_matches.date_unretweeted IS NOT NULL)
    THEN 1
      ELSE 0 END)                         AS unretweeted_count,
  avg(anagram_matches.interesting_factor) AS average_interesting_factor
FROM anagram_matches;
`;
    return pools.anagramPool.query(allTimeCountsQuery, [interestingFactorCutoff]).then(x => {
        const row = x.rows[0];
        for (const prop in row) {
            if (row.hasOwnProperty(prop)) {
                row[prop] = Number(row[prop]);
            }
        }
        return row;
    });
};

exports.getRecentCounts = function(interestingFactorCutoff, numberOfPastDays) {

    numberOfPastDays = Number(numberOfPastDays);
    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    const recentCountsQuery = `
SELECT
  recent_counts.*,
  recent_total_created_count / cast(${numberOfPastDays} AS DOUBLE PRECISION)      AS recent_total_created_average_per_day,
  recent_attempted_approval_count / cast(${numberOfPastDays} AS DOUBLE PRECISION) AS recent_attempted_approval_average_per_day,
  recent_rejected_count / cast(${numberOfPastDays} AS DOUBLE PRECISION)           AS recent_rejected_average_per_day,
  recent_retweet_count / cast(${numberOfPastDays} AS DOUBLE PRECISION)            AS recent_retweet_average_per_day,
  recent_tumblr_only_count / cast(${numberOfPastDays} AS DOUBLE PRECISION)        AS recent_tumblr_only_average_per_day,
  recent_unretweeted_count / cast(${numberOfPastDays} AS DOUBLE PRECISION)        AS recent_unretweeted_count_average_per_day
FROM (
       SELECT
         count(1)                                   recent_total_created_count,
         sum(CASE WHEN anagram_matches.attempted_approval IS TRUE
           THEN 1
             ELSE 0 END)                         AS recent_attempted_approval_count,
         sum(CASE WHEN anagram_matches.rejected IS TRUE
           THEN 1
             ELSE 0 END)                         AS recent_rejected_count,
         sum(CASE WHEN anagram_matches.date_retweeted IS NOT NULL AND anagram_matches.date_unretweeted IS NULL
           THEN 1
             ELSE 0 END)                         AS recent_retweet_count,
         sum(CASE WHEN anagram_matches.date_posted_tumblr IS NOT NULL AND
                       (anagram_matches.date_retweeted IS NULL OR anagram_matches.date_unretweeted IS NOT NULL)
           THEN 1
             ELSE 0 END)                         AS recent_tumblr_only_count,
         sum(CASE WHEN anagram_matches.interesting_factor > $1::float
           THEN 1
             ELSE 0 END)                         AS recent_meet_interesting_factor_filter_count,
         sum(CASE WHEN anagram_matches.date_unretweeted IS NOT NULL AND
                       (anagram_matches.date_retweeted IS NULL OR anagram_matches.date_unretweeted IS NOT NULL)
           THEN 1
             ELSE 0 END)                         AS recent_unretweeted_count,
         avg(anagram_matches.interesting_factor) AS recent_average_interesting_factor
       FROM anagram_matches
       WHERE date(anagram_matches.date_created) > current_date - INTERVAL '${numberOfPastDays}' DAY) recent_counts;
`;
    return pools.anagramPool.query(recentCountsQuery, [interestingFactorCutoff]).then(x => {
        const row = x.rows[0];
        for (const prop in row) {
            if (row.hasOwnProperty(prop)) {
                row[prop] = Number(row[prop]);
            }
        }
        return row;
    });
};

exports.getCountOfDaysMatchesHaveBeenRetweeted = function() {
    const countOfDaysMatchesHaveBeenRetweetedQuery = `
SELECT count(1) AS count_of_days_matches_have_been_retweeted
FROM (SELECT 1
      FROM anagram_matches
      WHERE date_retweeted IS NOT NULL
      GROUP BY date(date_retweeted)) dates;
`;
    return pools.anagramPool.query(countOfDaysMatchesHaveBeenRetweetedQuery).then(x => {
        return Number(x.rows[0].count_of_days_matches_have_been_retweeted);
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
                                     FROM candidateTweetIds));
`;

    return pools.anagramPool.query(countOfMatchesWithTweetAlreadyRetweetedQuery, [matchId]).then(x => {
        return Number(x.rows[0].count);
    });
};

exports.getMostRecentRetweetedStatusIds = function(limit = 100) {
    const mostRecentRetweetedStatusIdsQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.date_retweeted,
  anagram_matches.tweet1_retweet_id,
  anagram_matches.tweet2_retweet_id,
  t1.status_id AS t1_status_id,
  t2.status_id AS t2_status_id
FROM anagram_matches
  INNER JOIN tweets t1 ON anagram_matches.tweet1_id = t1.id
  INNER JOIN tweets t2 ON anagram_matches.tweet2_id = t2.id
WHERE anagram_matches.date_retweeted IS NOT NULL
ORDER BY anagram_matches.date_retweeted DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(mostRecentRetweetedStatusIdsQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.getTweetsToPostToTumblr = function(limit) {
    const retweetedAndNotUnretweetedAndNotPostedToTumblrQuery = `
SELECT
  anagram_matches.id,
  t1.status_id AS t1_status_id,
  t2.status_id AS t2_status_id,
  anagram_matches.posted_in_order
FROM anagram_matches
  INNER JOIN tweets t1 ON anagram_matches.tweet1_id = t1.id
  INNER JOIN tweets t2 ON anagram_matches.tweet2_id = t2.id
WHERE anagram_matches.date_retweeted IS NOT NULL
  AND anagram_matches.date_unretweeted IS NULL
  AND anagram_matches.date_posted_tumblr IS NULL
  AND anagram_matches.date_unposted_tumblr IS NULL
ORDER BY anagram_matches.date_retweeted
LIMIT $1::int;
`;

    return pools.anagramPool.query(retweetedAndNotUnretweetedAndNotPostedToTumblrQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.setUnpostedAndClearIds = function(matchId, unretweet, clearTumblrPostId, keepApproval) {
    const unretweetQuery = `
UPDATE anagram_matches
SET 
  date_unretweeted     = current_timestamp,
  date_retweeted       = NULL,
  tweet1_retweet_id    = NULL,
  tweet2_retweet_id    = NULL,
  unretweeted_manually = true,
  attempted_approval   = ${keepApproval}
WHERE id = $1::int;
`;

    const unretweetAndDeleteTumblrQuery = `
UPDATE anagram_matches
SET 
  date_unretweeted         = current_timestamp,
  date_retweeted           = NULL,
  tweet1_retweet_id        = NULL,
  tweet2_retweet_id        = NULL,
  unretweeted_manually     = true,
  tumblr_post_id           = NULL,
  date_posted_tumblr       = NULL,
  date_unposted_tumblr     = current_timestamp,
  unposted_tumblr_manually = true,
  attempted_approval       = ${keepApproval}
WHERE id = $1::int;
`;

    const deleteTumblrQuery = `
UPDATE anagram_matches
SET 
  tumblr_post_id           = NULL,
  date_posted_tumblr       = NULL,
  date_unposted_tumblr     = current_timestamp,
  unposted_tumblr_manually = true,
  attempted_approval       = ${keepApproval}
WHERE id = $1::int;
`;

    let queryToUseForUnretweeting;
    if (unretweet && clearTumblrPostId) {
        queryToUseForUnretweeting = unretweetAndDeleteTumblrQuery;
    } else if (unretweet && !clearTumblrPostId) {
        queryToUseForUnretweeting = unretweetQuery;
    } else if (!unretweet && clearTumblrPostId) {
        queryToUseForUnretweeting = deleteTumblrQuery;
    } else {
        throw `unknown error when unretweeting/unposting ${matchId} from tumblr.`;
    }

    return pools.anagramPool.query(queryToUseForUnretweeting, [matchId]).then(x => {
        if (x.rowCount != 1) {
            throw x;
        } else {
            return x;
        }
    });
};

exports.setUnretweetedFromTimelineCleanup = function(matchId) {
    const setUnretweetedFromTimelineCleanupQuery = `
UPDATE anagram_matches
SET 
  date_unretweeted         = current_timestamp,
  date_retweeted           = NULL,
  unretweeted_from_cleanup = TRUE
WHERE id = $1::int;
`;

    return pools.anagramPool.query(setUnretweetedFromTimelineCleanupQuery, [matchId]).then(x => {
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
  anagram_matches.interesting_factor        AS interesting,
  anagram_matches.date_retweeted,
  anagram_matches.date_posted_tumblr,
  anagram_matches.unretweeted_from_cleanup,
  anagram_matches.unretweeted_manually,
  anagram_matches.date_unretweeted,
  anagram_matches.posted_in_order,
  tweet1.id                                 AS t1_id,
  tweet2.id                                 AS t2_id,
  tweet1.original_text                      AS t1_originaltext,
  tweet2.original_text                      AS t2_originaltext,
  tweet1.user_name                          AS t1_username,
  tweet1.status_id                          AS t1_statusid,
  tweet2.user_name                          AS t2_username,
  tweet2.status_id                          AS t2_statusid
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE (anagram_matches.date_retweeted IS NOT NULL AND anagram_matches.date_unretweeted IS NULL) OR
      (anagram_matches.date_posted_tumblr IS NOT NULL AND anagram_matches.date_unposted_tumblr IS NULL)
ORDER BY COALESCE(anagram_matches.date_retweeted, anagram_matches.date_posted_tumblr) DESC
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
  anagram_matches.date_rejected,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id,
  tweet1.original_text               AS t1_originaltext,
  tweet2.original_text               AS t2_originaltext,
  tweet1.user_name                   AS t1_username,
  tweet1.status_id                   AS t1_statusid,
  tweet2.user_name                   AS t2_username,
  tweet2.status_id                   AS t2_statusid
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE anagram_matches.date_rejected IS NOT NULL
  AND anagram_matches.rejected = TRUE
  AND anagram_matches.tweet1_retweet_id IS NULL
  AND anagram_matches.tweet2_retweet_id IS NULL
ORDER BY anagram_matches.date_rejected DESC
LIMIT $1::int;
`;

    return pools.anagramPool.query(getRecentRejectedMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.getOldestTweetsNotInMatch = function(limit = 20) {
    const oldestTweetsNotInMatchQuery = `
SELECT *
FROM tweets
WHERE tweets.id NOT IN (SELECT tweet1_id
                        FROM anagram_matches) AND
      tweets.id NOT IN (SELECT tweet2_id
                        FROM anagram_matches)
ORDER BY tweets.date_existence_last_checked
LIMIT $1::int;
`;
    return pools.anagramPool.query(oldestTweetsNotInMatchQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.getDateOfOldestTweetWhoseExistenceHasNotBeenChecked = function() {
    const oldestExistenceNotCheckedQuery = `
SELECT date_existence_last_checked
FROM tweets
WHERE tweets.id NOT IN (SELECT tweet1_id
                        FROM anagram_matches) AND
      tweets.id NOT IN (SELECT tweet2_id
                        FROM anagram_matches)
ORDER BY tweets.date_existence_last_checked
LIMIT 1;
`;
    return pools.anagramPool.query(oldestExistenceNotCheckedQuery).then(x => {
        return x.rows[0].date_existence_last_checked;
    });
};

exports.updateTweetsExistenceChecked = function(tweetIds) {

    if (tweetIds.length == 0) {
        return Promise.resolve(0);
    }

    const updateExistenceCheckedQuery = `
UPDATE tweets
SET date_existence_last_checked = current_timestamp
WHERE id = ANY($1);
`;

    return pools.anagramPool.query(updateExistenceCheckedQuery, [tweetIds]).then(x => {
        if (x.rowCount != tweetIds.length) {
            throw x;
        } else {
            return x;
        }
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

exports.getInterestingFactorsForMatchesCreatedOnDate = function(formattedDate) {
    const getInterestingFactorsForMatchesCreatedOnDateQuery = `
SELECT DISTINCT ON (interesting_factor)
  trunc(anagram_matches.interesting_factor :: NUMERIC, 2) AS interesting_factor,
  count(anagram_matches.interesting_factor) OVER w AS total,
  sum(CASE WHEN anagram_matches.rejected = TRUE THEN 1 ELSE 0 END) OVER w AS rejected,
  sum(CASE WHEN anagram_matches.rejected = FALSE AND anagram_matches.attempted_approval = FALSE AND anagram_matches.date_unposted_tumblr IS NULL AND anagram_matches.date_unretweeted IS NULL THEN 1 ELSE 0 END) OVER w AS unreviewed
FROM anagram_matches
WHERE date(date_created) = '${formattedDate}'
WINDOW w AS (
  PARTITION BY trunc(anagram_matches.interesting_factor :: NUMERIC, 2) );
`;
    return pools.anagramPool.query(getInterestingFactorsForMatchesCreatedOnDateQuery).then(x => {
        return x.rows;
    });
};

exports.getNWayMatches = function(minimumNumberOfMatchesInGroup) {
    minimumNumberOfMatchesInGroup = clamp(minimumNumberOfMatchesInGroup, 2, 10000);
    const getNWayMatchesQuery = `
WITH tweetGroups AS (WITH matchGroups AS (SELECT
                                            t1.stripped_sorted_text,
                                            count(1) AS countOfMatches
                                          FROM anagram_matches
                                            INNER JOIN tweets t1 ON anagram_matches.tweet1_id = t1.id
                                          GROUP BY t1.stripped_sorted_text
                                          ORDER BY countOfMatches DESC)
SELECT
  tweets.id,
  original_text,
  tweets.stripped_sorted_text,
  count(tweets.stripped_sorted_text)
  OVER w AS number_of_matches_in_group
FROM tweets
  INNER JOIN matchGroups ON tweets.stripped_sorted_text = matchGroups.stripped_sorted_text
WINDOW w AS (
  PARTITION BY tweets.stripped_sorted_text )
)
SELECT
  id,
  original_text,
  stripped_sorted_text
FROM tweetGroups
WHERE number_of_matches_in_group > $1::int;
`;
    return pools.anagramPool.query(getNWayMatchesQuery, [minimumNumberOfMatchesInGroup]).then(x => {
        return x.rows;
    });
};

exports.averageScoreSurplusForApprovedMatches = function(interestingFactorCutoff = defaultInterestingFactor, numberOfPastDays) {

    numberOfPastDays = Number(numberOfPastDays);
    interestingFactorCutoff = clamp(interestingFactorCutoff, 0.0, 1.0);

    const approvedSurplusQuery = `
WITH scores_attempted_approval AS (SELECT
                                     avg(anagram_matches.interesting_factor)                             AS interesting_factor,
                                     avg(anagram_matches.inverse_lcs_length_to_total_length_ratio)       AS lcs_ratio,
                                     avg(anagram_matches.different_word_count_to_total_word_count_ratio) AS wc_ratio,
                                     avg(anagram_matches.edit_distance_to_length_ratio)                  AS ed_ratio,
                                     avg(anagram_matches.english_words_to_total_word_count_ratio)        AS ewc_ratio,
                                     avg(anagram_matches.total_length_to_highest_length_captured_ratio)  AS tl_ratio
                                   FROM anagram_matches
                                   WHERE date(anagram_matches.date_created) > current_date - INTERVAL '${numberOfPastDays}' DAY
                                     AND anagram_matches.attempted_approval IS TRUE
                                     AND anagram_matches.rejected IS FALSE
                                     AND anagram_matches.interesting_factor > $1::float),
    scores_rejected AS (SELECT
                          avg(anagram_matches.interesting_factor)                             AS interesting_factor,
                          avg(anagram_matches.inverse_lcs_length_to_total_length_ratio)       AS lcs_ratio,
                          avg(anagram_matches.different_word_count_to_total_word_count_ratio) AS wc_ratio,
                          avg(anagram_matches.edit_distance_to_length_ratio)                  AS ed_ratio,
                          avg(anagram_matches.english_words_to_total_word_count_ratio)        AS ewc_ratio,
                          avg(anagram_matches.total_length_to_highest_length_captured_ratio)  AS tl_ratio
                        FROM anagram_matches
                        WHERE date(anagram_matches.date_created) > current_date - INTERVAL '${numberOfPastDays}' DAY
                          AND anagram_matches.rejected IS TRUE
                          AND anagram_matches.interesting_factor > $1::float)
SELECT
  scores_attempted_approval.interesting_factor - scores_rejected.interesting_factor AS if_approved_surplus,
  scores_attempted_approval.lcs_ratio - scores_rejected.lcs_ratio                   AS lcs_approved_surplus,
  scores_attempted_approval.wc_ratio - scores_rejected.wc_ratio                     AS wc_approved_surplus,
  scores_attempted_approval.ed_ratio - scores_rejected.ed_ratio                     AS ed_approved_surplus,
  scores_attempted_approval.ewc_ratio - scores_rejected.ewc_ratio                   AS ewc_approved_surplus,
  scores_attempted_approval.tl_ratio - scores_rejected.tl_ratio                     AS tl_approved_surplus
FROM scores_attempted_approval, scores_rejected;
`;

    return pools.anagramPool.query(approvedSurplusQuery, [interestingFactorCutoff]).then(x => {
        const row = x.rows[0];
        return {
            ifApprovedSurplus: row.if_approved_surplus,
            lcsApprovedSurplus: row.lcs_approved_surplus,
            wcApprovedSurplus: row.wc_approved_surplus,
            edApprovedSurplus: row.ed_approved_surplus,
            ewcApprovedSurplus: row.ewc_approved_surplus,
            tlApprovedSurplus: row.tl_approved_surplus,
        };
    });
};

exports.averageScoreSurplusForApprovedMatchesByInterestingFactorScoreBucket = function(numberOfPastDays) {

    numberOfPastDays = Number(numberOfPastDays);

    const approvedScoreSurplusByInterestingFactorBucketQuery = `
WITH score_buckets AS (SELECT DISTINCT ON (interesting_factor)
                         trunc(anagram_matches.interesting_factor :: NUMERIC, 2) AS interesting_factor,
                         avg(CASE WHEN anagram_matches.attempted_approval IS TRUE AND anagram_matches.rejected IS FALSE
                           THEN anagram_matches.inverse_lcs_length_to_total_length_ratio END)
                         OVER w   AS lcs_ratio_attempted,
                         avg(CASE WHEN anagram_matches.rejected IS TRUE
                           THEN anagram_matches.inverse_lcs_length_to_total_length_ratio END)
                         OVER w   AS lcs_ratio_rejected,
                         avg(CASE WHEN anagram_matches.attempted_approval IS TRUE AND anagram_matches.rejected IS FALSE
                           THEN anagram_matches.different_word_count_to_total_word_count_ratio END)
                         OVER w   AS wc_ratio_attempted,
                         avg(CASE WHEN anagram_matches.rejected IS TRUE
                           THEN anagram_matches.different_word_count_to_total_word_count_ratio END)
                         OVER w   AS wc_ratio_rejected,
                         avg(CASE WHEN anagram_matches.attempted_approval IS TRUE AND anagram_matches.rejected IS FALSE
                           THEN anagram_matches.edit_distance_to_length_ratio END)
                         OVER w   AS ed_ratio_attempted,
                         avg(CASE WHEN anagram_matches.rejected IS TRUE
                           THEN anagram_matches.edit_distance_to_length_ratio END)
                         OVER w   AS ed_ratio_rejected,
                        avg(CASE WHEN anagram_matches.attempted_approval IS TRUE AND anagram_matches.rejected IS FALSE
                           THEN anagram_matches.english_words_to_total_word_count_ratio END)
                         OVER w   AS ewc_ratio_attempted,
                         avg(CASE WHEN anagram_matches.rejected IS TRUE
                           THEN anagram_matches.english_words_to_total_word_count_ratio END)
                         OVER w   AS ewc_ratio_rejected,
                         avg(CASE WHEN anagram_matches.attempted_approval IS TRUE AND anagram_matches.rejected IS FALSE
                           THEN anagram_matches.total_length_to_highest_length_captured_ratio END)
                         OVER w   AS tl_ratio_attempted,
                         avg(CASE WHEN anagram_matches.rejected IS TRUE
                           THEN anagram_matches.total_length_to_highest_length_captured_ratio END)
                         OVER w   AS tl_ratio_rejected
                       FROM anagram_matches
                       WHERE date(anagram_matches.date_created) > current_date - INTERVAL '${numberOfPastDays}' DAY
                       WINDOW w AS (
                         PARTITION BY trunc(anagram_matches.interesting_factor :: NUMERIC, 2)
                       ))
SELECT
  interesting_factor,
  lcs_ratio_attempted - lcs_ratio_rejected AS lcs_approved_surplus,
  wc_ratio_attempted - wc_ratio_rejected   AS wc_approved_surplus,
  ed_ratio_attempted - ed_ratio_rejected   AS ed_approved_surplus,
  ewc_ratio_attempted - ewc_ratio_rejected AS ewc_approved_surplus,
  tl_ratio_attempted - tl_ratio_rejected   AS tl_approved_surplus
FROM score_buckets;
`;

    return pools.anagramPool.query(approvedScoreSurplusByInterestingFactorBucketQuery).then(x => {
        return x.rows;
    });
};

exports.matchesWithTweet = function(tweetId) {
    const matchesWithTweetQuery = `
SELECT
  t1.id as t1_id,
  t2.id as t2_id,
  t1.original_text as t1_original_text,
  t2.original_text as t2_original_text,
  anagram_matches.*
FROM anagram_matches
  INNER JOIN tweets t1 ON t1.id = anagram_matches.tweet1_id
  INNER JOIN tweets t2 ON t2.id = anagram_matches.tweet2_id
WHERE tweet1_id = $1 OR tweet2_id = $1;
`;
    return pools.anagramPool.query(matchesWithTweetQuery, [tweetId]).then(x => {
        return x.rows;
    });
};

exports.retweetedMatchesThatContainTweetsFromThisMatch = function(matchId) {
    const retweetedMatchesThatContainTweetsFromThisMatchQuery = `
WITH matchTweetIds AS (SELECT
                         tweet1_id,
                         tweet2_id
                       FROM anagram_matches
                       WHERE id = $1::int),
    tweetIds AS (SELECT tweet1_id AS id
                 FROM matchTweetIds
                 UNION SELECT tweet2_id AS id
                       FROM matchTweetIds)
SELECT *
FROM anagram_matches
WHERE
  (anagram_matches.tweet1_id IN (SELECT id
                                 FROM tweetIds) OR
   anagram_matches.tweet2_id IN (SELECT id
                                 FROM tweetIds))
  AND anagram_matches.date_retweeted IS NOT NULL AND
  anagram_matches.date_unretweeted IS NULL;
`;
    return pools.anagramPool.query(retweetedMatchesThatContainTweetsFromThisMatchQuery, [matchId]).then(x => {
        return x.rows;
    });
};

exports.getTumblrPostIds = function() {
    const tumblrPostIdsQuery = `
SELECT tumblr_post_id
FROM anagram_matches
WHERE tumblr_post_id IS NOT NULL
ORDER BY date_posted_tumblr;
`;
    return pools.anagramPool.query(tumblrPostIdsQuery).then(x => {
        return x.rows.map(x => x.tumblr_post_id);
    });
};

exports.findTopScoringMatches = function(limit) {
    const topScoringMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
ORDER BY
  anagram_matches.interesting_factor DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(topScoringMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.findLongestMatches = function(limit) {
    const longestMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
ORDER BY
  anagram_matches.total_length_to_highest_length_captured_ratio desc
LIMIT $1::int;
`;
    return pools.anagramPool.query(longestMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.findHighestScoringExplicitlyRejectedMatches = function(limit) {
    const highestScoringExplicitlyRejectedMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE anagram_matches.rejected IS TRUE
      AND anagram_matches.auto_rejected IS FALSE
ORDER BY
  anagram_matches.interesting_factor DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(highestScoringExplicitlyRejectedMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.findHighestScoringApprovedMatches = function(limit) {
    const highestScoringApprovedMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE anagram_matches.attempted_approval IS TRUE
ORDER BY
  anagram_matches.interesting_factor DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(highestScoringApprovedMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.findLongAndHighInEnglishWordsExplicitlyRejectedMatches = function(limit) {
    const longAndHighInEnglishWordsExplicitlyRejectedMatchesQuery = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE anagram_matches.rejected IS TRUE
      AND anagram_matches.auto_rejected IS FALSE
      AND anagram_matches.english_words_to_total_word_count_ratio > 0.6
  AND anagram_matches.total_length_to_highest_length_captured_ratio > 0.5
ORDER BY
  anagram_matches.interesting_factor DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(longAndHighInEnglishWordsExplicitlyRejectedMatchesQuery, [limit]).then(x => {
        return x.rows;
    });
};

exports.findMostRecentManuallyUnretweetedMatches = function(limit) {
    const mostRecentManuallyUnretweetedMatches = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE anagram_matches.date_unretweeted IS NOT NULL AND anagram_matches.unretweeted_manually
ORDER BY
  anagram_matches.date_unretweeted DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(mostRecentManuallyUnretweetedMatches, [limit]).then(x => {
        return x.rows;
    });
};

exports.findMostRecentCleanedUpUnretweetedMatches = function(limit) {
    const mostRecentCleanedUpUnretweetedMatches = `
SELECT
  anagram_matches.id,
  anagram_matches.interesting_factor AS interesting,
  tweet1.original_text               AS t1_originalText,
  tweet2.original_text               AS t2_originalText,
  tweet1.id                          AS t1_id,
  tweet2.id                          AS t2_id
FROM
  anagram_matches
  INNER JOIN tweets tweet1 ON anagram_matches.tweet1_id = tweet1.id
  INNER JOIN tweets tweet2 ON anagram_matches.tweet2_id = tweet2.id
WHERE anagram_matches.date_unretweeted IS NOT NULL AND anagram_matches.unretweeted_from_cleanup IS TRUE
ORDER BY
  anagram_matches.date_unretweeted DESC
LIMIT $1::int;
`;
    return pools.anagramPool.query(mostRecentCleanedUpUnretweetedMatches, [limit]).then(x => {
        return x.rows;
    });
};

exports.getProcessedCounts = function(numberOfPastDays) {
    numberOfPastDays = clamp(numberOfPastDays, 1, 100000);
    const processedCountsQuery = `
SELECT
  round(cast(processed_counts.received_status_count_since_previous_reset / processed_counts.seconds_since_previous_reset AS NUMERIC), 1)                 AS statuses_received_per_second,
  round(cast(processed_counts.status_met_filter_count_since_previous_reset / processed_counts.seconds_since_previous_reset AS NUMERIC), 2)               AS statuses_met_filter_per_second,
  round(cast(processed_counts.tweet_met_filter_count_since_previous_reset / processed_counts.seconds_since_previous_reset AS NUMERIC), 2)                AS tweets_met_filter_per_second,
  round(cast(processed_counts.saved_tweet_count_since_previous_reset / processed_counts.seconds_since_previous_reset AS NUMERIC), 3)                     AS saved_tweets_per_second,
  round(cast(processed_counts.saved_anagram_count_since_previous_reset / processed_counts.seconds_since_previous_reset AS NUMERIC), 4)                   AS saved_anagrams_per_second,
  round(cast(processed_counts.saved_anagram_count_since_previous_reset / (processed_counts.seconds_since_previous_reset / 3600) AS NUMERIC), 1)          AS saved_anagrams_per_hour,
  round(cast(processed_counts.seconds_since_previous_reset / processed_counts.saved_tweet_count_since_previous_reset AS NUMERIC), 1)                     AS seconds_per_saved_tweet,
  round(cast(processed_counts.seconds_since_previous_reset / nullif(processed_counts.saved_anagram_count_since_previous_reset, 0) AS NUMERIC), 1)        AS seconds_per_saved_anagram,
  round(cast((processed_counts.seconds_since_previous_reset / 60) / nullif(processed_counts.saved_anagram_count_since_previous_reset, 0) AS NUMERIC), 1) AS minutes_per_saved_anagram,
  processed_counts.now                                                                                                                                   AS counts_recorded_timestamp
FROM processed_counts
WHERE processed_counts.now > current_date - INTERVAL '${numberOfPastDays}' DAY
ORDER BY counts_recorded_timestamp DESC
`;
    return pools.anagramPool.query(processedCountsQuery).then(x => {
        return x.rows;
    });
};

function clamp(x, a, b) {
    return Math.max(a, Math.min(x, b));
}

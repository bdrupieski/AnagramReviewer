const pools = require('./poolProvider');

const queuedMatchPendingStatus = 'pending';
const queuedMatchErrorStatus = 'error';
const queuedMatchErrorObservedStatus = 'error_ok';
const queuedMatchPostedStatus = 'posted';
const queuedMatchRemovedStatus = 'removed';

exports.queuedMatchPendingStatus = queuedMatchPendingStatus;
exports.queuedMatchErrorStatus = queuedMatchErrorStatus;
exports.queuedMatchErrorObservedStatus = queuedMatchErrorObservedStatus;
exports.queuedMatchPostedStatus = queuedMatchPostedStatus;
exports.queuedMatchRemovedStatus = queuedMatchRemovedStatus;

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

const pg = require('pg');
const dbConfig = require("../config.json").database;

function poolFromConfig(config) {
    return new pg.Pool({
        user: config.user,
        database: config.databaseName,
        password: config.password,
        host: config.host,
        port: config.port,
        max: config.maxConnections,
        idleTimeoutMillis: config.timeoutMilliseconds,
    });
}

const userPool = poolFromConfig(dbConfig.reviewer);
const anagramPool = poolFromConfig(dbConfig.anagram);

exports.userPool = userPool;
exports.anagramPool = anagramPool;

const pg = require('pg');
const dbConfig = require("../configuration/db.json");

function poolFromConfig(dbConfig) {
    const config = {
        user: dbConfig.user,
        database: dbConfig.databaseName,
        password: dbConfig.password,
        host: dbConfig.host,
        port: dbConfig.port,
        max: dbConfig.maxConnections,
        idleTimeoutMillis: dbConfig.timeoutMilliseconds,
    };
    return new pg.Pool(config);
}

const userPool = poolFromConfig(dbConfig.reviewerDatabase);
const anagramPool = poolFromConfig(dbConfig.anagramDatabase);

exports.userPool = userPool;
exports.anagramPool = anagramPool;

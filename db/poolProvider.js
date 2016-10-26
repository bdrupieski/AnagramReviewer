var pg = require('pg');
var dbConfig = require("../configuration/db.json");

function poolFromConfig(dbConfig) {
    var config = {
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

var userPool = poolFromConfig(dbConfig.reviewerDatabase);
var anagramPool = poolFromConfig(dbConfig.anagramDatabase);

exports.userPool = userPool;
exports.anagramPool = anagramPool;

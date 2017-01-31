const winston = require('winston');

winston.add(winston.transports.File, {
    name: 'info',
    filename: 'info.log',
    dirname: 'logs',
    maxsize: 5000000,
    level: 'info'
});

winston.add(winston.transports.File, {
    name: 'error',
    filename: 'error.log',
    dirname: 'logs',
    maxsize: 5000000,
    level: 'error'
});

const debugLogger = new winston.Logger({
    levels: {
        debug: 0
    },
    transports: [
        new (winston.transports.Console)({level: 'debug', stderrLevels: []})
    ]
});

const cleanUpLogger = new winston.Logger({
    transports: [
        new (winston.transports.File)({
            name: 'info',
            filename: 'cleanUp.info.log',
            dirname: 'logs',
            maxsize: 5000000,
            level: 'info'
        }),
        new (winston.transports.File)({
            name: 'error',
            filename: 'cleanUp.error.log',
            dirname: 'logs',
            maxsize: 5000000,
            level: 'error'
        }),
    ]
});

exports.debug = debugLogger.debug;
exports.info = winston.info;
exports.error = winston.error;
exports.cleanUp = {
    error: cleanUpLogger.error,
    info: cleanUpLogger.info
};

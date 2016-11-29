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

exports.debug = debugLogger.debug;
exports.info = winston.info;
exports.error = winston.error;

const hbs = require('hbs');

function safeFormatNumber(num, format, options) {
    const number = Number.parseFloat(num);
    if (num === null || num === undefined || Number.isNaN(number)) {
        return new hbs.SafeString("");
    } else {
        return hbs.handlebars.helpers.formatNumber(number, format, options);
    }
}

exports.registerCustomHelpers = function() {
    hbs.registerHelper('safeFormatNumber', safeFormatNumber);
};

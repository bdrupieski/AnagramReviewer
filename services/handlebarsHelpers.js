const hbs = require('hbs');

function safeFormatNumber(num, format, options) {
    const number = Number.parseFloat(num);
    if (num === null || num === undefined || Number.isNaN(number)) {
        return new hbs.SafeString("");
    } else {
        return hbs.handlebars.helpers.formatNumber(number, format, options);
    }
}

function nullDateFormat(date, format, options) {
    if (date === null || date === undefined) {
        return new hbs.SafeString("");
    } else {
        return hbs.handlebars.helpers.formatDate(date, format, options);
    }
}

function boolAsYesNo(bool, format, options) {
    if (!bool) {
        return new hbs.SafeString("No");
    } else {
        return new hbs.SafeString("Yes");
    }
}

function checkedIf(condition) {
    return condition ? "checked" : "";
}

function inOrderArrows(condition) {
    return condition ? "⇉" : "⤮";
}

exports.registerCustomHelpers = function() {
    hbs.registerHelper('safeFormatNumber', safeFormatNumber);
    hbs.registerHelper('nullDateFormat', nullDateFormat);
    hbs.registerHelper('boolAsYesNo', boolAsYesNo);
    hbs.registerHelper('checkedIf', checkedIf);
    hbs.registerHelper('inOrderArrows', inOrderArrows);
};

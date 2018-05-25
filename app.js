const env = require('dotenv').config();
const express = require('express');
const path = require('path');
const favicon = require('serve-favicon');
const logger = require('morgan');
const bodyParser = require('body-parser');
const flash = require('connect-flash');
const schedule = require('node-schedule');

const routes = require('./routes/index');
const account = require('./routes/account');
const anagrams = require('./routes/anagrams');
const tweets = require('./routes/tweets');
const tasks = require('./services/tasks');

const app = express();

const handlebarsIntl = require('handlebars-intl');
const hbs = require('hbs');
handlebarsIntl.registerWith(hbs);
require("./services/handlebarsHelpers").registerCustomHelpers();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(require('cookie-parser')());
app.use(express.static(path.join(__dirname, 'public')));

const passport = require('passport');

const sessionConfig = require('./config.json').session;
const cookieSession = require('cookie-session');
app.use(cookieSession({
    secret: sessionConfig.secret,
    maxAge: 24 * 60 * 60 * 1000 * 365
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

const passportService = require("./services/passport");
passportService.configure();

// every minute
schedule.scheduleJob("*/1 * * * *", function () {
    tasks.deleteFromDatabaseTheOldestTweetsThatNoLongerExist(59);
});

// 17 minutes after the hour every hour
schedule.scheduleJob("17 * * * *", function () {
    tasks.retweetOnePendingMatch();
});

// 15 minutes past the hour every 6 hours
schedule.scheduleJob("15 */6 * * *", function () {
    tasks.cleanUpAnyBrokenPairsInRecentRetweets();
});

app.use(function(req, res, next){
    res.locals.user = req.user;
    next();
});

app.use(function(req, res, next){
    res.locals.errorMessage = req.flash('error');
    res.locals.infoMessage = req.flash('info');
    res.locals.successMessage = req.flash('success');
    next();
});

app.use('/', routes);
app.use('/account', account);
app.use('/anagrams', anagrams);
app.use('/tweets', tweets);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function (err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;

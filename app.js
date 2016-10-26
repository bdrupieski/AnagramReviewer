var env = require('dotenv').config();
var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var bodyParser = require('body-parser');
var flash = require('connect-flash');
var winston = require('winston');

winston.add(winston.transports.File, {
    name: 'info',
    filename: 'info.log',
    dirname: 'logs',
    maxsize: 100000,
    level: 'info'
});

winston.add(winston.transports.File, {
    name: 'error',
    filename: 'error.log',
    dirname: 'logs',
    maxsize: 100000,
    level: 'error'
});

var routes = require('./routes/index');
var account = require('./routes/account');
var anagrams = require('./routes/anagrams');

var app = express();

var handlebarsIntl = require('handlebars-intl');
var hbs = require('hbs');
handlebarsIntl.registerWith(hbs);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(require('cookie-parser')());
app.use(express.static(path.join(__dirname, 'public')));

var passport = require('passport');
var Strategy = require('passport-local').Strategy;
var userDb = require("./db/users");

var sessionConfig = require('./configuration/session.json');
var cookieSession = require('cookie-session');
app.use(cookieSession({
    secret: sessionConfig.secret,
    cookie: { maxAge: 1000 * 60 * 60 * 30 * 365 }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

var passportConfig = require("./services/passport");
passportConfig.configure();

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

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    var err = new Error('Not Found');
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

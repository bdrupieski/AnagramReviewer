const userDb = require("../db/users");
const passport = require('passport');
const Strategy = require('passport-local').Strategy;
const logger = require('./logger');
const bcrypt = require('./bcryptPromisified');

exports.configure = function () {
    passport.use(new Strategy(
        function (username, password, cb) {
            logger.info(`sign in attempt for ${username}`);
            userDb.findByUsername(username).then(user => {

                if (!user) {
                    logger.error(`invalid username ${username}`);
                    return cb(null, false, {message: "not a valid user"});
                }

                bcrypt.comparePassword(password, user.passwordhash).then(success => {
                    if (success) {
                        return cb(null, user, {message: "successfully logged in"});
                    } else {
                        logger.error(`unsuccessful log in attempt for ${username}`);
                        return cb(null, false, {message: "invalid password"});
                    }
                }).catch(err => {
                    logger.error(`error hashing password for ${username}`);
                    return cb(err);
                });

            }).catch(err => {
                logger.error(`error retrieving username ${username}`);
                return cb(err);
            });
        }));

    passport.serializeUser(function (user, done) {
        done(null, user.id);
    });

    passport.deserializeUser(function (id, done) {
        userDb.findById(id).then(user => {
            done(null, user);
        }).catch(err => {
            logger.error(`error deserializing user ${id}`);
            return done(err);
        });
    });
};

exports.isLoggedIn = function(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.redirect('/');
    }
};

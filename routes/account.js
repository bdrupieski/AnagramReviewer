const express = require('express');
const router = express.Router();
const passport = require('passport');
const passportConfig = require('../services/passport');
const userDb = require('../db/users');
const bcrypt = require('../services/bcryptPromisified');
const logger = require('winston');

router.get('/', function (req, res) {
    res.redirect('account/login');
});

router.get('/login', function (req, res) {
    res.render('account/login', {
        title: 'Log in'
    });
});

router.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: 'login',
    failureFlash: true
}), function (req, res) {
    res.redirect('/');
});

router.get('/logout', function (req, res) {
    req.logout();
    res.redirect('/');
});

router.get('/profile', passportConfig.isLoggedIn, function (req, res) {
    res.render('account/profile', {
        title: 'Profile'
    });
});

router.get('/changepassword', passportConfig.isLoggedIn, function(req, res) {
    res.render('account/changepassword');
});

router.post('/changepassword', passportConfig.isLoggedIn, function(req, res) {
    logger.info(`change password attempted for ${req.user.username}`);

    if (req.body.newPassword != req.body.newPasswordCheck) {
        req.flash('error', "new passwords don't match");
        return res.redirect('changepassword');
    }

    const userId = req.user.id;
    userDb.findById(userId).then(user => {
        return bcrypt.comparePassword(req.body.currentPassword, user.passwordhash);
    }).then(success => {
        if (success) {
            return bcrypt.hashPassword(req.body.newPassword);
        } else {
            throw "existing password is not a match";
        }
    }).then(hash => {
        return userDb.updatePasswordHash(userId, hash);
    }).then(x => {
        req.flash('success', 'password changed');
        res.redirect('profile');
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('profile');
    });
});

module.exports = router;

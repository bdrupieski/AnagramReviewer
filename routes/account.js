const express = require('express');
const router = express.Router();
const passport = require('passport');
const passportConfig = require('../services/passport');
const userDb = require('../db/users');
const logger = require('../services/logger');
const validator = require('validator');
const userManagement = require('../services/userManagement');

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

    const userId = req.user.id;
    const currentPassword = req.body.currentPassword;
    const newPassword = req.body.newPassword;
    const newPasswordCheck = req.body.newPasswordCheck;

    if (newPassword != newPasswordCheck) {
        req.flash('error', "The passwords do not match.");
        return res.redirect('changepassword');
    }

    return userManagement.checkExistingAndUpdateNewPassword(userId, currentPassword, newPassword).then(x => {
        req.flash('success', 'Password changed.');
        res.redirect('profile');
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('profile');
    });
});

router.get('/requestpasswordreset', function(req, res) {
    res.render('account/requestpasswordreset');
});

router.post('/requestpasswordreset', function(req, res) {

    const email = req.body.email;

    if (!validator.isEmail(email)) {
        req.flash('error', `${email} doesn't look like a valid e-mail address.`);
        return res.redirect('requestpasswordreset');
    }

    return userDb.findByEmail(email).then(user => {
        if (user) {
            return userManagement.sendPasswordResetEmail(user.id);
        } else {
            return false;
        }
    }).then(x => {
        req.flash('info', `A password reset request has been sent to ${email}.`);
        res.redirect('/');
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/');
    });
});

router.get('/resetpassword', function(req, res) {
    const resetToken = req.query.token;
    res.render('account/resetpassword', {
        resetToken: resetToken
    });
});

router.post('/resetpassword', function(req, res) {
    const resetToken = req.body.resetToken;
    const newPassword = req.body.newPassword;
    const newPasswordCheck = req.body.newPasswordCheck;

    if (newPassword != newPasswordCheck) {
        req.flash('error', "The passwords do not match.");
        return res.redirect(`resetpassword?token=${resetToken}`);
    }

    return userManagement.updatePassword(resetToken, newPassword).then(x => {
        req.flash('success', "Password successfully reset.");
        res.redirect('login');
    }).catch(err => {
        logger.error(err.toString());
        req.flash('error', err.toString());
        res.redirect('/');
    })
});

module.exports = router;

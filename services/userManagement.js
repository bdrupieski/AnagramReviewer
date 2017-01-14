const userDb = require('../db/users');
const bcryptPromisified = require('../services/bcryptPromisified');
const validator = require('validator');
const crypto = require('crypto');
const mail = require('./mail');
const passwordResetConfig = require('../config.json').passwordReset;

exports.createUser = function(username, email, password) {

    const isEmailValid = validator.isEmail(email);

    if (!isEmailValid) {
        return Promise.reject(`${email} is invalid.`)
    }

    return bcryptPromisified.hashPassword(password).then(hashedPassword => {
        return userDb.createUser(username, email, hashedPassword);
    });
};

exports.checkExistingAndUpdateNewPassword = function(userId, currentPassword, newPassword) {
    return userDb.findById(userId).then(user => {
        return bcryptPromisified.comparePassword(currentPassword, user.passwordhash);
    }).then(success => {
        if (success) {
            return bcryptPromisified.hashPassword(newPassword);
        } else {
            throw "Existing password is not a match.";
        }
    }).then(hash => {
        return userDb.updatePasswordHash(userId, hash);
    });
};

exports.updatePassword = function(token, newPassword) {

    return Promise.all([
        userDb.findByPasswordResetToken(token),
        bcryptPromisified.hashPassword(newPassword)
    ]).then(([user, hash]) => {
        const resetExpiration = new Date(user.password_reset_token_expiration);
        const now = new Date();

        if (now < resetExpiration) {
            return userDb.updatePasswordHash(user.id, hash);
        } else {
            throw 'Reset token expired.'
        }
    })
};

exports.sendPasswordResetEmail = function(userId) {
    return updateUserWithPasswordResetToken(userId).then(token => {
        return userDb.findById(userId);
    }).then(user => {
        return mail.sendPasswordResetEmail(user.email, user.password_reset_token);
    });
};

function updateUserWithPasswordResetToken(userId) {

    let resetToken;

    return generateResetToken().then(token => {
        resetToken = token;

        const resetExpiration = new Date();
        resetExpiration.setMinutes(resetExpiration.getMinutes() + passwordResetConfig.resetExpirationInMinutes);

        return userDb.updatePasswordResetToken(userId, resetToken, resetExpiration);
    }).then(x => {
        return resetToken;
    });
}

function generateResetToken() {
    return new Promise((resolve, reject) => {
        crypto.randomBytes(42, function(err, buf) {
            if (err) {
                return reject(err);
            } else if (buf) {
                const token = buf.toString('hex');
                return resolve(token);
            } else {
                return reject('unknown error when generating reset token');
            }
        });
    });
}

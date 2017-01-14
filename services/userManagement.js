const userDb = require('../db/users');
const bcryptPromisified = require('../services/bcryptPromisified');
const validator = require('validator');

exports.createUser = function(username, email, password) {

    const isEmailValid = validator.isEmail(email);

    if (!isEmailValid) {
        return Promise.reject(`${email} is invalid.`)
    }

    return bcryptPromisified.hashPassword(password).then(hashedPassword => {
        return userDb.createUser(username, email, hashedPassword);
    });
};

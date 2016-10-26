var bcrypt = require('bcrypt');

exports.comparePassword = function (plainTextPassword, hashedPassword) {
    return new Promise((resolve, reject) => {
        bcrypt.compare(plainTextPassword, hashedPassword, function (err, res) {
            if (err) {
                return reject(err);
            } else {
                resolve(res);
            }
        });
    });
};

exports.hashPassword = function (password) {
    return new Promise((resolve, reject) => {
        bcrypt.hash(password, 7, function (err, hash) {
            if (err) {
                return reject(err);
            } else {
                return resolve(hash);
            }
        });
    });
};

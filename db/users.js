const pools = require('./poolProvider');

exports.findById = function (id) {
    return pools.userPool.query("select * from app_user where id = $1::int limit 1", [id]).then(x => {
        return x.rows[0];
    });
};

exports.findByUsername = function (username) {
    return pools.userPool.query("select * from app_user where username = $1::text limit 1", [username]).then(x => {
        return x.rows[0];
    });
};

exports.findByPasswordResetToken = function(passwordResetToken) {
    return pools.userPool.query("select * from app_user where password_reset_token = $1::text limit 1", [passwordResetToken]).then(x => {
        return x.rows[0];
    });
};

exports.findByEmail = function(email) {
    return pools.userPool.query("select * from app_user where email = $1::text limit 1", [email]).then(x => {
        return x.rows[0];
    });
};

exports.updatePasswordHash = function(id, newPasswordHash) {
    return pools.userPool.query("update app_user set passwordhash = $1::text, password_reset_token = null, password_reset_token_expiration = null where id = $2::int", [newPasswordHash, id]);
};

exports.createUser = function(username, email, passwordHash) {
    return pools.userPool.query("insert into app_user (username, email, passwordhash) values ($1::text, $2::text, $3::text)", [username, email, passwordHash]);
};

exports.updatePasswordResetToken = function(id, resetToken, resetTokenExpiration) {
    return pools.userPool.query("update app_user set password_reset_token = $2::text, password_reset_token_expiration = $3 where id = $1::int", [id, resetToken, resetTokenExpiration]);
};

var pools = require('./poolProvider');

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

exports.updatePasswordHash = function(id, newPasswordHash) {
    return pools.userPool.query("update app_user set passwordhash = $1::text where id = $2::int", [newPasswordHash, id]);
};

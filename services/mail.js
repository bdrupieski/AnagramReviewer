const mailgunConfig = require("../configuration/mailgun.json");
const siteConfig = require("../configuration/site.json");
const mailgun = require('mailgun-js')({apiKey: mailgunConfig.apiKey, domain: mailgunConfig.domain});
const passwordResetConfig = require('../configuration/passwordReset.json');

exports.sendPasswordResetEmail = function(emailAddress, resetToken) {

    const url = `${siteConfig.baseUrl}/account/resetpassword?token=${resetToken}`;

    const data = {
        from: mailgunConfig.fromField,
        to: emailAddress,
        subject: 'AnagramReviewer password reset',
        text:
`You are receiving this e-mail because a password reset was requested for your account. 
        
Click here to reset your password: ${url}

If you do not want to reset your password, ignore this e-mail and your password will remain unchanged.

This reset request expires in ${passwordResetConfig.resetExpirationInMinutes} minutes.`
    };

    return sendMail(data);
};

function sendMail(data) {
    return new Promise((resolve, reject) => {
        mailgun.messages().send(data, function (error, body) {
            if (error) {
                return reject(error);
            } else if (body) {
                return resolve(body);
            } else {
                return reject('unknown error when sending mail');
            }
        });
    });
}

const userManagement = require('./../services/userManagement');

const username = process.argv[2];
const email = process.argv[3];
const password = process.argv[4];

console.log(`creating user ${username} with email ${email} and password ${password}`);

userManagement.createUser(username, email, password).then(x => {
    console.log("seemed to work:");
    console.log(x);
}).catch(err => {
    console.log(err);
});

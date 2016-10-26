let gulp = require('gulp');
let concat = require('gulp-concat');
let uglify = require('gulp-uglify');
let pump = require('pump');
let concatCss = require('gulp-concat-css');
let minifyCss = require('gulp-clean-css');

// jQuery first or bootstrap complains
let jsSources = [
    "public-dev/javascripts/jquery*.js",
    "public-dev/javascripts/*.js"
];

gulp.task('concatminifyjs', function (cb) {
    pump([
            gulp.src(jsSources),
            concat('app-front-end.js'),
            uglify(),
            gulp.dest('public/javascripts')
        ],
        cb
    );
});

gulp.task('concatminifycss', function (cb) {
    pump([
            gulp.src('public-dev/stylesheets/*.css'),
            concatCss('app-stylesheets.css'),
            minifyCss(),
            gulp.dest('public/stylesheets')
        ],
        cb
    );
});

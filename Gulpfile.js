const gulp = require('gulp');
const concat = require('gulp-concat');
const uglify = require('gulp-uglify');
const pump = require('pump');
const concatCss = require('gulp-concat-css');
const minifyCss = require('gulp-clean-css');

// jQuery first or bootstrap complains
const jsSources = [
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

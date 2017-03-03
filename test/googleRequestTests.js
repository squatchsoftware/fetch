"use strict";
var assert = require('assert');
var fs = require('fs');
var skilRequestPlayer = require("./googleRequestPlayer");
var async = require('async');
/*
For code coverage.
npm install -g mocha
npm install -g istanbul
istanbul cover _mocha -- -R spec
open coverage/lcov-report/index.html
*/

// mocha --debug-brk


// Load the google request files.
var skillsRequestFolder = "test/googlerequests/";
var skillRequestFiles = fs.readdirSync(skillsRequestFolder);

describe("Google Request tests.", function() {
    async.each(skillRequestFiles, function(el, cb) {
        it("GoogleRequest: " + el, function(done) {
            skilRequestPlayer.runSkillRequestTestFile(el, done);
        })
        cb();
    })
});
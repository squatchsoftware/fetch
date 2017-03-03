"use strict";
var assert = require('assert');
var fs = require('fs');
var skilRequestPlayer = require("./alexaRequestPlayer");
var async = require('async');
/*
For code coverage.
npm install -g mocha
npm install -g istanbul
istanbul cover _mocha -- -R spec
open coverage/lcov-report/index.html
*/

// mocha --debug-brk

// Load the alexaRequestFiles
var skillsRequestFolder = "test/alexarequests/";
var skillRequestFiles = fs.readdirSync(skillsRequestFolder);

describe("AlexaRequest tests.", function() {
    async.each(skillRequestFiles, function(el, cb) {
        it("AlexaRequest: " + el, function(done) {
            skilRequestPlayer.runSkillRequestTestFile(el, done);
        })
        cb();
    })
});
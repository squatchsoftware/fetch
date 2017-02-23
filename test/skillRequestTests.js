"use strict";
var assert = require('assert');
var fs = require('fs');
var skilRequestPlayer = require("./skillRequestPlayer");
var async = require('async');
/*
For code coverage.
npm install -g mocha
npm install -g istanbul
istanbul cover _mocha -- -R spec
open coverage/lcov-report/index.html
*/

// mocha --debug-brk


// Load the skillRequestFiles
var skillsRequestFolder = "test/skillrequests/";
var skillRequestFiles = fs.readdirSync(skillsRequestFolder);

describe("SkillRequest tests.", function(){
async.each(skillRequestFiles, function(el, cb){
           it("SkillRequest: " + el, function(done){
                skilRequestPlayer.runSkillRequestTestFile(el, done);
            })
           cb();
        })
});


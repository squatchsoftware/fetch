"use strict";
var assert = require('assert');
var fs = require('fs');
var uuid = require('uuid');

// Globals
// Future: consider .config file// output directory to use for persisting Recordings.
var skillsRequestFolder = "test/googlerequests/";

// mocha --debug-brk
var logger = require('../common/logger');

// Let caller override the folder to look for the Skills request file.
exports.setSkillsRequestFolder = function setSkillsRequestFolder(folder) {
    skillsRequestFolder = folder;
}

// helper methods
exports.runSkillRequestTestFile = function runSkillRequestTestFile(skillRequestFile, done) {
    // Load in Fetch google action lambda
    var fetch = require('../googleaction/index');

    var originalGraphClient = fetch.getMicrosoftGraph();

    // Load in Stub classes.
    var microsoftGraphStub = require("./stubs/microsoft-graph-client");

    // Set fetch to use the GraphStub.
    fetch.setMicrosoftGraph(microsoftGraphStub.Client);

    var testCase = LoadJSONTesFile(skillRequestFile);

    // break the test into the properties.
    var googleActionEvent = testCase.googleActionEvent;
    var graphMailBoxSettingsRequest = testCase.graphMailBoxSettingsRequest;
    var graphMailBoxSettingsResponseError = testCase.graphMailBoxSettingsResponseError;
    var graphMailBoxSettingsResponse = testCase.graphMailBoxSettingsResponse;
    var graphcalendarViewRequest = testCase.graphcalendarViewRequest;
    var graphcalendarViewResponseError = testCase.graphcalendarViewResponseError;
    var graphcalendarViewResponse = testCase.graphcalendarViewResponse;
    var expectedServiceResponseSucceed = testCase.googleActionResponse;
    var expectedServiceResponseFail = null; // currently just a response.

    // Setup the Graph calls and response.
    microsoftGraphStub.clearPathMappings();
    microsoftGraphStub.addPathMapping(graphMailBoxSettingsRequest, graphMailBoxSettingsResponse, graphMailBoxSettingsResponseError);
    microsoftGraphStub.addPathMapping(graphcalendarViewRequest, graphcalendarViewResponse, graphcalendarViewResponseError);

    // invoke the lambda call.
    var context = {
        succeed: function(response) {

            var expectedOutputString = JSON.stringify(expectedServiceResponseSucceed);
            var reponseString = JSON.stringify(response);

            if (expectedOutputString != reponseString) {
                console.log(expectedOutputString);
                console.log(reponseString);
            }

            assert.equal(reponseString, expectedOutputString);

            fetch.setMicrosoftGraph(originalGraphClient); // Set back the graph client.
            done();
        },
        fail: function(response) {
            assert.equal(JSON.stringify(expectedServiceResponseFail), JSON.stringify(response));
            fetch.setMicrosoftGraph(originalGraphClient); // Set back the graph client.
            done();
        }
    };

    logger.attach(context);
    fetch.handler(googleActionEvent, context);
}

// creates a json object from the givein file path for the Request
// and the expected response.
function LoadJSONTesFile(fileName) {

    var fileFullPath = skillsRequestFolder + fileName;

    var testFile = fs.readFileSync(fileFullPath, 'utf-8');
    return JSON.parse(testFile);
}

// similiar to router in the lambdarouter used by tests to  
function routeLambdaNoProxy(event, context, lambda) {
    lambda(event, context);
}
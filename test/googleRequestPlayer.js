"use strict";
var assert = require('assert');
var fs = require('fs');
var uuid = require('uuid');
var jwt = require("jwt-simple");

// Globals
// Future: consider .config file// output directory to use for persisting Recordings.
var skillsRequestFolder = "test/googlerequests/";

// mocha --debug-brk
var authHelper = require('../common/authhelper');
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

    // Test files contain the access token that the authProvider created.
    // Wrap here for testing encoding/decoding.
    // Future: Consider putting tokens in test files if also switch over Alexa
    // to AuthV2.0 or have an unit test helper to create a token to use.
    var body = JSON.parse(googleActionEvent.body);
    var access_Token = body.originalRequest.data.user.access_token;

    // make up an identity accessToken
    let issuedTime = Date.now() / 1000;
    let identityInfo = {
        iat: issuedTime,
        exp: issuedTime + 3600,
        name: "Squatch Software",
        preferred_username: "squatchsoftware@outlook.com",
        ver: "2.0",
        tid: "9188040d-6c67-4c5b-b112-36a304b66dad"
    };

    let identity_token = jwt.encode(identityInfo, "testSigningKey");

    let encodedToken = authHelper.encodeTokenInformation(identity_token, access_Token);
    let decodedToken = authHelper.decodeTokenInformation(encodedToken); // make sure can decode.

    // make the new token the access_token in the google request.
    body.originalRequest.data.user.access_token = encodedToken;
    googleActionEvent.body = JSON.stringify(body);

    // JSON.stringify(decoded)) let decodedToken = authHelper.decodeTokenInformation(accessToken);
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
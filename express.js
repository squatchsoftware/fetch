/*
Express wrapper around the lambda router.
this provides a convenient way to run the lambda methods through an http request same
as when called from the Amazon Gateway services.
*/

var express = require("express");
var bodyParser = require("body-parser");
var lambdarouter = require('./lambdarouter.js');

var app = express();
var PORT = process.env.port || 8081;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

/*
Converts the request as it comes into Express into what a Lamdba request 
comes in from Amazaon Gateway services with lambda proxy integration
*/
function callExpressUrlAsLambda(req, res) {
    var context = {
        succeed: function(response) {
            // map the response to express
            res.statusCode = response.statusCode;
            res.header = response.header;
            res.end(response.body);
        },
        fail: function(response) {
            // todo: currently don't handle failure.
        }
    };

    var body;
    if (req.headers['content-type'] == 'application/x-www-form-urlencoded') {
        // express has made into json in the req.body.
        // Need to convert it back to formUrlEncoded.
        var bodyJson = req.body;
        var encoded = '';

        for (var key in bodyJson) {
            if (encoded.length > 1) {
                encoded += "&"
            }

            encoded += encodeURIComponent(key) + '=' + encodeURIComponent(bodyJson[key]);
        }

        body = encoded;
    } else {
        body = JSON.stringify(req.body);
    }

    var resource;
    var params;
    var originalUrl = req.originalUrl;
    var queryParamIndex = originalUrl.indexOf('?');
    if (queryParamIndex > 0) {
        resource = originalUrl.substring(0, queryParamIndex);
        params = originalUrl.substring(queryParamIndex + 1);
    } else {
        resource = originalUrl;
        params = '';
    }

    var lambdaWeb = {
        'resource': req.path,
        'queryStringParameters': req.query,
        'headers': req.headers,
        'body': body
    }

    lambdarouter.handler(lambdaWeb, context);
}

/*
Send all Get requests to the lambda router 
*/
app.get('/*', function(req, res) {
    callExpressUrlAsLambda(req, res);
});

/*
Send all Post requests to the lambda router 
*/
app.post("/*", function(req, res) {
    callExpressUrlAsLambda(req, res);
});

app.listen(PORT);
console.log("Listening on port " + PORT + ", try http://localhost:" + PORT + "/common/oauth2/authorize");


// Can optionally run unit tests here in the Express wrapper as simple way to debug.

// Alexa skill Unit Test
/*
var skillRequestTests = require("./test/alexaRequestPlayer.js");
skillRequestTests.setSkillsRequestFolder("./test/alexarequests/");
skillRequestTests.runSkillRequestTestFile("thisweekend_oneevent.json",
    function done() {

    });
*/

// Google Action Unit Test
/*
var skillRequestTests = require("./test/googleRequestPlayer.js");
skillRequestTests.setSkillsRequestFolder("./test/googlerequests/");
skillRequestTests.runSkillRequestTestFile("googleWeekendNoEvents.json",
    function done() {

    });
*/
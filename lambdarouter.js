// route lambda calls to proper handlers.
"use strict";

var logger = require('./common/logger');

// Lambdas to route to.
var fetchLambda = require('./fetchskill/index');
var webLambda = require('./web/index.js');

/*
All Lambda's we get from Gateway have proxy information.
Need to remove the proxy information before passing to the Alexa skill
lambda and then conver the response back to http
*/
function routeLambdaNoProxy(event, context, lambda) {

    var jsonLambda = JSON.parse(event.body);

    var contextNoProxy = {
        succeed: function(response) {

            // Check if callback already called. should only be called once
            if (context.calledBack) {
                logger.log(context, "!!Error: context callback called more than once.");
            }

            var body = JSON.stringify(response);
            var httpResponse = {
                statusCode: '200',
                body: body,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            context.calledBack = true;
            context.succeed(httpResponse);
        },
        fail: function(response) {

            // check if callback already called. should only be called once
            if (context.calledBack) {
                logger.log(context, "!!Error: context callback called more than once.");
            }

            context.logger.log("!!!Error: Alexa skill failed. " + JSON.stringify(response));
            context.calledBack = true;

            context.fail(response);
        },

        // transfer over items from context
        logger: logger.attach(context),
    };

    lambda(jsonLambda, contextNoProxy);
}

/*
Lambda handler.
*/
exports.handler = function(event, context) {

    logger.attach(context);

    var resourcePath = event.resource;
    logger.log(context, "routing based on path: " + resourcePath);

    // Future: Api gateway seems case-sensitive on Urls but may have to revisit if need comparison
    switch (resourcePath) {
        case '/skills/fetch':
            routeLambdaNoProxy(event, context, fetchLambda.handler);
            break;
        default:
            // default to the webLambda. 
            webLambda.handler(event, context);
            break;
    }
};

/*
Lambda Router for when fetch skill called directly from Amazon Lambda.
*/
exports.fetchLambdaDirect = function(event, context) {
    fetchLambda.handler(event, context);
}
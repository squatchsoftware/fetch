/*
Called to get a m_TokenEndpoint.
Wraps the login.windows.net m_TokenEndpoint
*/

var superagent = require("superagent");
var logger = require('../common/logger');

/* lambda handler */
exports.handler = function(event, context) {

    var m_TokenEndpoint = "https://login.windows.net/common/oauth2/token";

    superagent
        .post(m_TokenEndpoint)
        .query(event.queryStringParameters)
        .type('form')
        .send(event.body) // 
        .end(function(error, response) {
            if (error) {
                logger.log(context, "!!Error: getting refresh token. " + JSON.stringify(error));
            } else {
                //  logger.log(context, "Success getting refresh token");
            }

            httpResponse = {
                statusCode: response.statusCode,
                body: JSON.stringify(response.body),
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            context.succeed(httpResponse);
        });
};
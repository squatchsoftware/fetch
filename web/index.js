/*
Lambda entry point for web pages

The request comes in from Amazaon Gateway services with lambda proxy integration
*/

"use strict";

var fs = require('fs');
var ejs = require('ejs');
var superagent = require("superagent");
// var lambdaRefreshToken = require('./lambdaRefreshToken');

var base64 = require('../common/base64');
var config = require('../common/config');
var logger = require('../common/logger');
var authHelper = require('../common/authhelper');

/* template data */
var templateExtension = ".html";
var privacyTemplateName = "privacy";
var authorizeTemplateName = "authorize";

/* google templates */
var googlePrivacyTemplateName = "googleprivacy";
var googleAuthorizeTemplateName = "googleauthorize";
var googleAuthorizeV2TemplateName = "googleauthorizev2";

/* wordOfTheWeekTemplates*/
var wordOfTheWeektemplatefolder = "./wordoftheweek/web/views/";
var wordOfTheWeekPrivacyTemplateName = "privacy";

/* store templates in memory.
Future: this is okay since we have a small set of templates. If have more or larger size consider a different method
*/
var loadedTemplates = {};

/* 
Get the template for the templateName.
if the template doesn't exist null is returned
*/
function getTemplate(templateName, templateFolder) {
    var templateData = loadedTemplates[templateName];
    if (!templateData) {
        // file on disk should be in the /views folder with the name matching
        // the template.
        if (!templateFolder) {
            templateFolder = "./web/views/";
        }

        var templateFilePath = templateFolder + templateName + templateExtension;

        templateData = fs.readFileSync(templateFilePath, 'utf-8');
        loadedTemplates[templateName] = templateData;
    }

    return templateData;
}

/* 
Renders the template with the given properties
*/
function renderTemplate(event, context, templateName, properties, templateFolder) {
    var webPageString = getTemplate(templateName, templateFolder);
    if (null == webPageString) {
        webPageString = templateName + " is unavailable";
        logger.log(webPageString);
    } else {
        // If have properties use ejs to render the html
        if (properties) {
            webPageString = ejs.render(webPageString, properties, null);
        }
    }

    sendTextResponse(context, webPageString);
}

/*
Helper to convert flat json data to form urlencoding 
suitable for queryParams or in a Form encoded body */
function htmlFormEncode(data) {
    var encoded = '';
    for (var key in data) {
        if (encoded.length > 1) {
            encoded += "&"
        }

        encoded += encodeURIComponent(key) + '=' + encodeURIComponent(data[key]);
    }

    return encoded;
}

/*
Helper to convert encoded form and url encodings back to json
*/
function htmlFormDecode(data) {

    var decoded = {};

    var items = data.split("&");
    for (var i in items) {
        var item = items[i];
        var nameValue = item.split("=");

        decoded[nameValue[0]] = nameValue[1] ? decodeURIComponent(nameValue[1]) : null;
    }

    return decoded;
}

/*
Builds a RequestInfo object from the lambda event
Currently only used to build the ServerPath but could be expanded and get its own class.
*/
function GetRequestInformation(event) {
    var requestInfo = {
        protocol: event.headers["X-Forwarded-Proto"], // https:, http:
        host: event.headers["Host"],
        port: event.headers["X-Forwarded-Port"],
        stage: (event.requestContext) ? event.requestContext.stage : null,
        path: event.path,
        queryParams: event.queryStringParameters,

        GetServerPath: function() {

            // builds the path to the server Url.
            var serverPath = this.protocol + "://" + this.host;
            if (this.port) {
                serverPath += ":" + this.port;
            }
            serverPath += "/";

            // if have a stage add that on as well.
            if (this.stage) {
                serverPath += this.stage + "/";
            }

            return serverPath;
        }
    }

    return requestInfo
}

/* 
Forward a request for a refresh token onto the OAuth endpoint
*/
function forwardRefreshToken(event, context, tokenEndpoint, encodeIdToken) {

    superagent
        .post(tokenEndpoint)
        .query(event.queryStringParameters)
        .type('form')
        .send(event.body) // 
        .end(function(error, response) {
            if (error) {
                logger.log(context, "!!Error: getting refresh token. " + JSON.stringify(error));
            } 
            else {
                // Encode the access token.
                response.body.access_token = authHelper.encodeTokenInformation(
                    context,
                    (encodeIdToken) ? response.body.id_token : null,
                    response.body.access_token);
            }

            let httpResponse = {
                statusCode: response.statusCode,
                body: JSON.stringify(response.body),
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            context.succeed(httpResponse);
        });
};
/*
Helper method to send the given text as an httpResponse
*/
function sendTextResponse(context, responseBody) {
    var httpResponse = {
        "statusCode": "200",
        "body": responseBody,
        "headers": {
            'Content-Type': 'text/html; charset=UTF-8'
        }
    }

    context.succeed(httpResponse);
}

/*
Helper method to send a redirect.
*/
function sendRedirctResponse(context, locationUrl) {
    var httpResponse = {
        statusCode: '302',
        headers: {
            'Content-Type': 'text/html; charset=UTF-8',
            "Location": locationUrl
        }
    };

    context.succeed(httpResponse);
}


/*
Build the array of properties to  use when rendering the authorization template
*/
function GetAuthorizationTemplateProperties(event, context) {

    var requestInfo = GetRequestInformation(event);
    var authorizeQuery = event.queryStringParameters;

    // Google doesn't allow query params on the authorize so we need to add them on.
    // Future: could remove from Alexa registration to also not have the params to be consistent.
    authorizeQuery["resource"] = "00000003-0000-0000-c000-000000000000";
    authorizeQuery["prompt"] = "consent";

    // Build the adal Url.
    var adalLoginUrl = "https://login.windows.net/common/oauth2/authorize" + '?' + htmlFormEncode(authorizeQuery);

    // set the template properties
    var props = {
        'adalLoginUrl': adalLoginUrl
    };

    return props;
}


/*
Build the array of properties to  use when rendering the authorization template
*/
function GetV20AuthorizationTemplateProperties(event, context) {

    var requestInfo = GetRequestInformation(event);
    var authorizeQuery = event.queryStringParameters;

    // remove the Google Action code challenges if present.
    //  "code_challenge_method": "S256",
    // "code_challenge": "5C4yVkRmsov2WK-yfxeOaWzeIzbTC6VRKO44lGihxYU"
    // event.queryStringParameters["code_challenge_method"] = "challengeMethod";

    delete authorizeQuery["code_challenge_method"];
    delete authorizeQuery["code_challenge"];

    // Build the adal Url.
    var adalLoginUrl = "https://login.windows.net/common/oauth2/v2.0/authorize" + '?' + htmlFormEncode(authorizeQuery);

    // set the template properties
    var props = {
        'adalLoginUrl': adalLoginUrl
    };

    console.log("temp: props: " + JSON.stringify(props));

    return props;
}


/* lambda entry point */
exports.handler = function(event, context) {

    var resourcePath = event.resource;

    console.log("webRequest: " + JSON.stringify(event));

    // Api gateway seems case-sensitive on Urls but may have to revisit if need comparison
    switch (resourcePath) {
        case '/common/oauth2/token':
        case '/common/oauth2/googletoken':
            // v1.0 endpoint only returns idToken on an Authorization code so for consistenty on 
            // Authcode and refresh token don't encode any idToken.
            forwardRefreshToken(event, context, "https://login.windows.net/common/oauth2/token", false /* encodeIdToken */ );
            break;
        case '/common/oauth2/v2.0/googletoken':
            forwardRefreshToken(event, context, "https://login.windows.net/common/oauth2/v2.0/token", true /* encodeIdToken */ );
            break;
        case '/common/oauth2/authorize':
            var props = GetAuthorizationTemplateProperties(event, context);
            renderTemplate(event, context, authorizeTemplateName, props);
            break;
        case '/common/oauth2/googleauthorize':
            var props = GetAuthorizationTemplateProperties(event, context);
            renderTemplate(event, context, googleAuthorizeTemplateName, props);
            break;
        case "/common/oauth2/v2.0/googleauthorize":
            var props = GetV20AuthorizationTemplateProperties(event, context);
            renderTemplate(event, context, googleAuthorizeV2TemplateName, props);
            break;
        case '/web/privacy':
            renderTemplate(event, context, privacyTemplateName, null);
            break;
        case '/web/googleprivacy':
            renderTemplate(event, context, googlePrivacyTemplateName, null);
            break;
        case '/web/wordoftheweek/privacy':
            renderTemplate(event, context, wordOfTheWeekPrivacyTemplateName, null, wordOfTheWeektemplatefolder);
            break;
        default:
            // Future: add a general page missing or route to a home page.
            sendTextResponse(context, "Unsupported Web path: " + event.resource);
            break;
    }
};
/*
Lambda entry point for web pages

The request comes in from Amazaon Gateway services with lambda proxy integration
*/

"use strict";

var fs = require('fs');
var ejs = require('ejs');
var lambdaRefreshToken = require('./lambdaRefreshToken');
var logger = require('../common/logger');

/* template data */
var templateExtension = ".html";
var privacyTemplateName = "privacy";
var authorizeTemplateName = "authorize";

/* google templates */
var googlePrivacyTemplateName = "googleprivacy";
var googleAuthorizeTemplateName = "googleauthorize";



/* store templates in memory.
Future: this is okay since we have a small set of templates. If have more or larger size consider a different method
*/
var loadedTemplates = {};

/* 
Get the template for the templateName.
if the template doesn't exist null is returned
*/
function getTemplate(templateName) {
    var templateData = loadedTemplates[templateName];
    if (!templateData) {
        // file on disk should be in the /views folder with the name matching
        // the template.
        var templateFilePath = "./web/views/" + templateName + templateExtension;
        templateData = fs.readFileSync(templateFilePath, 'utf-8');
        loadedTemplates[templateName] = templateData;
    }

    return templateData;
}

/* 
Renders the template with the given properties
*/
function renderTemplate(event, context, templateName, properties) {
    var webPageString = getTemplate(templateName);
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
Build the array of properties to  use when rendering the authorization template
*/
function GetAuthorizationTemplateProperties(event, context) {
    var authorizeQuery = event.queryStringParameters;

    // encode the authorize query. same code as form encoding 
    // there must be a helper library already to convier query params to string
    var encoded = '';
    for (var key in authorizeQuery) {
        if (encoded.length > 1) {
            encoded += "&"
        }

        encoded += encodeURIComponent(key) + '=' + encodeURIComponent(authorizeQuery[key]);
    }

    // Build the adal Url.
    var adalLoginUrl = "https://login.windows.net/common/oauth2/authorize" + '?' + encoded;


    // set the template properties
    var props = {
        'schema': 'schemavalue',
        'utterances': 'utter datmud',
        'adalLoginUrl': adalLoginUrl
    };

    return props;
}

/*
Template properties for the Google authorization template properties
*/
function GetGoogleAuthorizationTemplateProperties(event, context) {

    var props = GetAuthorizationTemplateProperties(event, context);

    // Future: The Alexa registration has these params in the authorizationUrl registered with Amazon. 
    // Google doesn't allow query params on the authorize so we need to add  them on.
    // Could update Alexa registration to also not have the params to be consistent.
     var adalLoginUrl = props.adalLoginUrl + "&prompt=consent&resource=00000003-0000-0000-c000-000000000000";
    props.adalLoginUrl = adalLoginUrl;

    return props;
}

/* lambda entry point */
exports.handler = function(event, context) {

    var resourcePath = event.resource;

    // Api gateway seems case-sensitive on Urls but may have to revisit if need comparison
    switch (resourcePath) {
        case '/common/oauth2/token':
        case '/common/oauth2/googletoken':
            // Token has no web UI so call it as a lambda.
            lambdaRefreshToken.handler(event, context);
            break;
        case '/common/oauth2/authorize':
            var props = GetAuthorizationTemplateProperties(event, context);
            renderTemplate(event, context, authorizeTemplateName, props);
            break;
        case '/common/oauth2/googleauthorize':
            var props = GetGoogleAuthorizationTemplateProperties(event, context);
            renderTemplate(event, context, googleAuthorizeTemplateName, props);
            break;
        case '/web/privacy':
            renderTemplate(event, context, privacyTemplateName, null);
            break;
        case '/web/googleprivacy':
            renderTemplate(event, context, googlePrivacyTemplateName, null);
            break;
        default:
            // Future: add a general page missing or route to a home page.
            sendTextResponse(context, "Unsupported Web path: " + event.resource);
            break;
    }
};
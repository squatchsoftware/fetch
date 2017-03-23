/*
Lambda entry point for Google actions

The request comes in from Amazaon Gateway services with lambda proxy integration
*/

"use strict";

var googleActions = require("actions-on-google");
var ApiAssistant = googleActions.ApiAiAssistant;
var moment = require('moment');
var jwt = require("jwt-simple");

var authHelper = require('../common/authhelper');
var logger = require('../common/logger');
var config = require('../common/config');
var fetchRecorder = require("../common/fetchRecorder.js");
var graph = require("../common/graph");
var timezone = require('../common/timezone.js');


/*
setMicrosoftGraph allows caller to overide default MicrosoftGraph package.
This is used by the unit tests to stub out calls to Microsoft Graph.
*/
exports.setMicrosoftGraph = function(graphClient) {
    graph.setMicrosoftGraph(graphClient);
}

/*
getMicrosoftGraph client
*/
exports.getMicrosoftGraph = function() {
    return graph.getMicrosoftGraph();
}

/*
Response Handler for the GetEvents intent 
*/
function responseHandlerGetEvents(context, assistant) {

    var body = assistant.body_;

    // Check if body has userInfo. 
    // We check ourselves since the getUser() call on the google assistant will throw
    // and return its own error.
    var userInfo = (body &&
        body.originalRequest &&
        body.originalRequest.data &&
        body.originalRequest.data.user) ? body.originalRequest.data.user : null;

    // See if can get the Access token.
    var accessToken
    if (userInfo) {
        accessToken = userInfo.access_token;
    } else {
        // If no accessToken check the Config file if there is one to use.
        // This is convenient in some test scenarios.
        accessToken = config.settings("googleToken");
    }

    // if no access token then tell the user about linking.
    if (!accessToken) {
        logger.addProperty(context, "email", "NoToken");
        assistant.tell("Account linking is not setup for Fetch.");
        return;
    }

    try {
        let decodedToken = authHelper.decodeTokenInformation(accessToken);

        // update the access token to be the unwrapped token.
        accessToken = decodedToken.access_token;

        logger.addProperty(context, "email", decodedToken.preferred_username);
        logger.addProperty(context, "tokenType", decodedToken.tokenType);
        logger.addProperty(context, "endpointVersion", decodedToken.endpointVersion);
    } catch (ex) {
        logger.addProperty(context, "email", "Error getting token: " + ex);
    }

    // Get the mailbox settings for the time timezone.
    // Future: see if way to get this directly from Google instead.
    graph.getMailBoxSettingsTimeZone(context, accessToken, function(err, windowsTimeZone) {
        if (null != err) {
            var output = "An error occured getting Calendar timezone information. " + err.message;
            logger.addProperty(context, "error", output);
            assistant.tell(output);
            return;
        } else {
            logger.addProperty(context, "windowsTimeZone", windowsTimeZone);
            var timeZoneName = timezone.mapWindowsTimeToOlson(windowsTimeZone);
            if (!timeZoneName) {
                var output = "unable to map windowTimeZone " + windowsTimeZone;
                logger.addProperty(context, "error", output);
                assistant.tell(output);
                return;
            }

            logger.addProperty(context, "timeZoneName", timeZoneName);

            // Use the Timestamp sent in the body as the currentUserTime. 
            var currentUserTime = moment.tz(body.timestamp, timeZoneName);

            // get the dateTime.
            var dateTime = assistant.getArgument("dateTime"); // time for the calendar request.

            // Save the intentData for logging
            logger.addProperty(context, "intentData", dateTime);

            // Parse the dateTime into a time range and normalize as UTC
            // Either a single value or if spans date then of form "2017-03-04/2017-03-05"
            var dateRange = dateTime.split("/");
            var startDateText;
            var endDateText;
            if (dateRange.length > 1) {
                startDateText = new moment.tz(dateRange[0], timeZoneName).toJSON();

                // For the endDate its the last full day so set hour and minutes to the end of the day.
                var endDate = new moment.tz(dateRange[1], timeZoneName);
                endDate.set('hour', 23);
                endDate.set('minute', 59);
                endDateText = endDate.toJSON();


            } else {
                startDateText = new moment.tz(dateTime, timeZoneName).toJSON();

                // If no end time set to be the end of the startDate.
                var endDate = new moment.tz(startDateText, timeZoneName);
                endDate.set('hour', 23);
                endDate.set('minute', 59);
                endDateText = endDate.toJSON();
            }

            // Check we have both a start and end date
            if (startDateText && endDateText) {
                graph.getCalendarEventsOutputText(
                    context,
                    accessToken,
                    currentUserTime.toJSON(),
                    startDateText,
                    endDateText,
                    null, // friendlyName. Don't have any friendlyName information like from Alexa.
                    timeZoneName,
                    function(err, outputText) {
                        // if have an error change the outputText to match.
                        if (err) {
                            outputText = err.message;
                            logger.addProperty(context, "error", outputText);
                        }

                        assistant.tell("<speak> " + outputText + " </speak>");
                        return;
                    });
            } else {
                assistant.tell('There is no start and end time');
                return;
            }
        }
    });
}

/*
/* lambda entry point */
exports.handler = function(event, context) {

    // Make a context object for passing state to responseHandlers.
    var googleActioncontext = {};


    // Attach the Logger.
    logger.attach(googleActioncontext)

    // Attach the recorder.
    fetchRecorder.attach(googleActioncontext);
    fetchRecorder.recordEvent(googleActioncontext, "googleActionEvent", event);

    /*
        The google sdk expects a call as if from Express 
        Convert the lambda event to an Express request object.
    */
    var req = {

        get: function get(headerName) {
            var headerValue = event.headers[headerName];
            return headerValue;
        },

        body: JSON.parse(event.body)
    }

    /*
        The google sdk Expects express so make an Express response object
        That will send the response back to lambda
    */
    var res = {

        // headers to return in the reponse.
        headers: {},

        status: function status(code) {
            this.statusCode = code;
            return this;
        },

        /*
            Appends the header.
        */
        append: function append(headerName, headerValue) {
            this.headers[headerName] = headerValue;
        },

        /*
            Send the response
        */
        send: function send(responseBody) {
            var httpResponse = {
                "statusCode": this.statusCode,
                "body": JSON.stringify(responseBody),
                "headers": this.headers,
            };

            // finish off the recording of the request.
            fetchRecorder.recordEvent(googleActioncontext, "googleActionResponse", httpResponse);
            fetchRecorder.persistRecording(googleActioncontext);

            var propertyBag = logger.getProperties(googleActioncontext);

            // Log out information about the request.
            var googleData = {
                "GoogleRequest": "",
                "email": logger.getProperty(googleActioncontext, "email"),
                "statusCode": this.statusCode,

                "properties": propertyBag
            }

            logger.log(googleActioncontext, JSON.stringify(googleData))

            // send the httpResponse in a context.succeed back to lambda.
            context.succeed(httpResponse);
        }
    };

    // Create an ApiAssistant to handle the request
    const assistant = new ApiAssistant({ request: req, response: res });

    // setup the response Handlers.
    function responseHandlerGetEventsStub(assistant) {
        responseHandlerGetEvents(googleActioncontext, assistant);
    }

    // Call the ApiAssistant to handle the request.
    assistant.handleRequest(responseHandlerGetEventsStub);
};
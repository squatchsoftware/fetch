"use strict";

var Alexa = require('alexa-sdk');
var jwt = require("jwt-simple");
var moment = require('moment');

var authHelper = require('../common/authhelper');
var config = require('../common/config');
var fetchRecorder = require("../common/fetchRecorder.js");
var graph = require("../common/graph");
var logger = require('../common/logger');
var timezone = require('../common/timezone.js');

var amazonDateTime = require("./amazonDateTime");


// Flag for if should piiScrub what is written out to logs.
// !!Always should be true for Production deployments
var piiScrub = config.settings("piiScrub");

// AppIds that recognize.
var allowedAppIds = config.settings("allowedAppIds");

// Skills name
var skillName = "<s>This is Fetch</s>";

// Message when the skill is first called
var welcomeMessage = "<s>You can ask whats on my calendar today</s> <s>To exit Fetch you can say cancel</s><s>For more examples you can Ask for help</s>";

// Message for help inten
var helpMessage = "<s>Here are some things you can say</s>" +
    "<s>what is on my calendar today</s>" +
    "<s>what do I have tomorrow</s>" +
    "<s>what is happening this evening</s>" +
    "<s>what is on my calendar on Tuesday</s>" +
    "<s>what is scheduled on May 14th</s>" +
    "";

// Used to tell user skill is closing
var shutdownMessage = "Ok see you again soon.";

// Used when an event is asked for
var killSkillMessage = "<s>Okay,Closing Fetch.</s>";

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
Lambda handler for skill.
*/
exports.handler = function(event, contextCaller, callback) {

    // wrap the handler context so can log the result
    var context = {
        succeed: function(response) {

            fetchRecorder.recordEvent(context, "serviceResponseSucceed", response);
            fetchRecorder.persistRecording(context);
            logServiceResponse(context, event, response);

            contextCaller.succeed(response);
        },
        fail: function(response) {
            fetchRecorder.recordEvent(context, "serviceResponseFail", response);
            fetchRecorder.persistRecording(context);

            logServiceResponse(context, event, response);

            contextCaller.fail(response);
        },

        // transfer over items from context 
        logger: logger.attach(contextCaller)
    };

    // See if there is a token for the context.
    var accessToken;
    if (event.session.user) {
        accessToken = event.session.user.accessToken;
    }

    if (!accessToken) {
        logger.addProperty(context, "email", "NoToken");
    } else {
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

        context.accessToken = accessToken;
    }

    // setup serviceRequestRecorder
    fetchRecorder.attach(context);

    // log out the service request.
    logServiceRequest(context, event);
    fetchRecorder.recordEvent(context, "serviceRequest", event);

    // setup and call the Alexa sdk handler.
    let alexaHandler = Alexa.handler(event, context);

    // Check if appId is known before setting.
    // if appId is ngrok leave it else convert to lambda
    if (allowedAppIds[event.session.application.applicationId]) {
        alexaHandler.appId = event.session.application.applicationId;
    }

    alexaHandler.registerHandlers(newSessionHandlers, fetchEventModeHandlers);
    alexaHandler.execute();
};

// The states skill can be in.
// state is null for initial state.
var states = {
    FETCHEVENTSMODE: '_fetchEventsMode', // expect Intent for fetching calendar event items.
};

/*
NewSession state handler
*/
var newSessionHandlers = {
    'LaunchRequest': function() {
        this.handler.state = states.FETCHEVENTSMODE;

        // Check if there is an access token and if not give message to link the skill.
        // Future: consolidate check with others after confirm need this for certification.
        var accessToken = this.event.session.user.accessToken;
        if (!accessToken) {
            let output = "You must have an account linked to use this skill. Please use the Alexa app to link an account.";
            this.emit(":tellWithLinkAccountCard", output, output);
            return;
        }

        this.emit(':ask', skillName + " " + welcomeMessage, welcomeMessage);
    },

    'fetchEventsIntent': function() {
        fetchEventsIntentHandler(this);
    },

    'Unhandled': function() {
        this.emit(':ask', helpMessage, helpMessage);
    },
};


/*
FETCHEVENTSMODE stateHandler
*/
var fetchEventModeHandlers = Alexa.CreateStateHandler(states.FETCHEVENTSMODE, {
    'AMAZON.YesIntent': function() {
        let output = welcomeMessage;
        this.emit(':ask', output, welcomeMessage);
    },

    'AMAZON.NoIntent': function() {
        this.emit(':tell', shutdownMessage);
    },

    'AMAZON.RepeatIntent': function() {
        this.emit(':ask', output, helpMessage);
    },

    'fetchEventsIntent': function() {
        let parent = this;
        fetchEventsIntentHandler(this);
    },

    'AMAZON.HelpIntent': function() {
        let output = helpMessage;
        this.emit(':ask', output, output);
    },

    'AMAZON.StopIntent': function() {
        this.emit(':tell', killSkillMessage);
    },

    'AMAZON.CancelIntent': function() {
        this.emit(':tell', killSkillMessage);
    },

    'SessionEndedRequest': function() {
        this.emit(':tell', killSkillMessage);;
    },

    'Unhandled': function() {
        this.emit(':ask', helpMessage, helpMessage);
    }
});

/*
Handles the fetchEventsIntent
*/
function fetchEventsIntentHandler(sessionHandler) {
    let sessionState = sessionHandler.handler.state;
    let context = sessionHandler.context;

    // determine if existing session by if there is a handler.state. Will be null on initial request.
    var existingSession = false;
    if (sessionState) {
        existingSession = true;
    }

    // Do a tell or ask dependent on if want session left open.
    // Future. for now we only tell. will need ask if add support for details of meetings.
    var verb = ":tell";
    if (existingSession) {
        //  verb = ":ask"; 
    }

    var accessToken = sessionHandler.context.accessToken;
    if (!accessToken) {
        output = "You must have an account linked to use this skill. Please use the Alexa app to link an account.";
        logger.addProperty(context, "error", output);
        sessionHandler.emit(":tellWithLinkAccountCard", output, output);
        return;
    }

    // by default if don't find any messages go back to default state
    sessionHandler.handler.state = null;
    graph.getMailBoxSettingsTimeZone(context, accessToken, function(err, windowsTimeZone) {
        if (null != err) {
            var output = "An error occured getting Calendar timezone information. " + err.message;
            logger.addProperty(context, "errorMessage", output);
            logger.addProperty(context, "errorDetails", err);
            sessionHandler.emit(verb, output, output);
        } else {

            logger.addProperty(context, "windowsTimeZone", windowsTimeZone);

            var timeZoneName = timezone.mapWindowsTimeToOlson(windowsTimeZone);
            if (!timeZoneName) {
                var output = "unable to map windowTimeZone " + windowsTimeZone;
                logger.addProperty(context, "error", output);
                sessionHandler.emit(verb, output, output);;
                return;
            }

            // Store the timeZone in the session attributes. 
            sessionHandler.attributes["timeZone"] = timeZoneName;
            logger.addProperty(context, "timeZoneName", timeZoneName);


            // Read slot data and parse out a usable date 
            var eventDate = amazonDateTime.getCalendarStartEndTimes(sessionHandler.event.request.intent.slots, timeZoneName);

            // Check we have both a start and end date
            if (eventDate.startDate && eventDate.endDate) {
                graph.getCalendarEventsOutputText(
                    sessionHandler.context,
                    accessToken,
                    sessionHandler.event.request.timestamp, // use the timestamp from Amazon as the current time as the user.
                    eventDate.startDate,
                    eventDate.endDate,
                    eventDate.friendlyName,
                    timeZoneName,
                    function(err, outputText) {
                        // if have an error change the outputText to match.
                        if (err) {
                            outputText = err.message;
                            logger.addProperty(context, "errorMessage", outputText);
                            logger.addProperty(context, "errorDetails", err);
                        }

                        sessionHandler.emit(":tell", outputText);
                        return;
                    });
            }
        }
    });
}

/*
Logs the service reequest with any Personal information removed.
Future:  consider moving any useful debugging data in the response so in one single log.
*/
function logServiceRequest(context, event) {
    // clone the original object so can log pii scrubbed data.
    var piiScrubbed = JSON.parse(JSON.stringify(event));

    // stub out PII info.
    if (piiScrubbed.session.user.accessToken) {
        // Scrub out both the accessToken 
        if (piiScrub) {
            piiScrubbed.session.user.accessToken = "PII<>";
            if ((piiScrubbed.context) &&
                (piiScrubbed.context.System) &&
                (piiScrubbed.context.System.user) &&
                (piiScrubbed.context.System.user.accessToken)) {
                piiScrubbed.context.System.user.accessToken = "PII<>";
            }
        }
    }

    logger.log(context, JSON.stringify(piiScrubbed));
}

/*
Logs the service response with any Personal information removed.
*/
function logServiceResponse(context, event, response) {

    var request;
    let requestIntent;
    if (event) {
        requestIntent = event.request;
    } else {
        requestIntent = "No request data.";
    }

    var piiScrubbedResponse;
    try {
        piiScrubbedResponse = JSON.parse(JSON.stringify(response));
    } catch (ex) {
        piiScrubbedResponse = {
            error: "error parsing response: " + ex.message
        }
    }

    // Future: should have markers or another PII build string as the response is made
    //  we can log out to give the part of the response the doesn't have Customer eventData.
    if (piiScrubbedResponse && piiScrub) {
        // Remove the speak text since may contain customer appointments.
        if (piiScrubbedResponse.response) {
            if (piiScrubbedResponse.response.outputSpeech) {
                piiScrubbedResponse.response.outputSpeech = "PII<>";
            }

            if (piiScrubbedResponse.response.reprompt) {
                piiScrubbedResponse.response.reprompt = "PII<>";
            }
        }
    }

    let properties = logger.getProperties(context);

    var alexaData = {
        "AlexaRequest": "",
        "email": logger.getProperty(context, "email"),

        "intent": requestIntent,
        "responseData": piiScrubbedResponse,
        "properties": properties
    }

    logger.log(context, JSON.stringify(alexaData));
}
"use strict";

/*
Morph into word of week can first make same as fetch ngrok and then add 
database support.

http://docs.aws.amazon.com/amazondynamodb/latest/gettingstartedguide/GettingStarted.NodeJs.03.html#GettingStarted.NodeJs.03.02
https://console.aws.amazon.com/dynamodb/home?region=us-east-1#tables:selected=dbWorkOfWeek

*/


var Alexa = require('alexa-sdk');
var AWS = require('aws-sdk');
var jwt = require("jwt-simple");
var moment = require('moment');

var authHelper = require('../../common/authhelper');
var config = require('../../common/config');
var fetchRecorder = require("../../common/fetchRecorder.js");
var graph = require("../../common/graph");
var logger = require('../../common/logger');
var timezone = require('../../common/timezone.js');

// Setup the AWS config  
AWS.config.update({
    accessKeyId: config.settings("wordoftheweek_dbtablewordofweek_accesskeyId"),
    secretAccessKey: config.settings("wordoftheweek_dbtablewordofweek_secretAccessKey"),
    region: config.settings("wordoftheweek_dbtablewordofweek_region"),
});

// Flag for if should piiScrub what is written out to logs.
// Currently no Pii information in wordOfWeek so set to false.
var piiScrub = false;

// AppIds that recognize.
var allowedAppIds = config.settings("allowedAppIds");

// get list of preview users
var alexaPreviewUsers = config.settings("alexaPreviewUsers");

// Skills name
var skillName = "<s>This is the word of the week</s>";

// Message when the skill is first called
var welcomeMessage = "<s>You can ask what is the word of the week</s> <s>To exit you can say cancel</s>";

/*
Example phrases: (todo: try Open the word of the week)
Alexa, open Word of the Week
Alexa, ask Word of the Week what is the word of the week
Alexa, ask word of the Week how to submit a word
*/

// Message for help intent
var helpMessage =
    "<s>You can ask what is the word of the week</s>" +
    "<s>or to find out how to submit a word ask how do I submit a word of the week</s>" +
    /*    "<s>what do I have tomorrow</s>" +
        "<s>what is happening this evening</s>" +
        "<s>what is on my calendar on Tuesday</s>" +
        "<s>what is scheduled on May 14th</s>" + */
    "";

// Used to tell user skill is closing
var shutdownMessage = "Ok see you again soon.";

// Used when an event is asked for
var killSkillMessage = "<s>Okay, closing The Word of the Week.</s>";


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

        this.emit(':ask', skillName + " " + welcomeMessage, welcomeMessage);
    },

    'WordOfTheWeekIntent': function() {
        fetchEventsIntentHandler(this);
    },

    'SuggestAWordOfTheWeekIntent': function() {
        suggestAWordOfTheWeekIntentHandler(this);
    },

    'Unhandled': function() {
        this.emit(':ask', helpMessage, helpMessage);
    },
};


/*
WORDOFTHEWEEKMODE stateHandler
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

    'SuggestAWordOfTheWeekIntent': function() {
        let parent = this;
        suggestAWordOfTheWeekIntentHandler(this);
    },

    'WordOfTheWeekIntent': function() {
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
Handle the suggestAWordOfTheWeekIntent 

To submit a word of the week please email squatchsoftware@outlook.com. 
Be sure to include the word and a description as to what makes it the word of the week. You may also optionally include a dedication.

*/
function suggestAWordOfTheWeekIntentHandler(sessionHandler) {
    let sessionState = sessionHandler.handler.state;
    let context = sessionHandler.context;
    let speechOutput = "<s>To submit a word of the week or report an issue please email squatchsoftware@outlook.com</s>";
    var cardTitle = 'Submit a word of the week';
    var cardContent = "To submit a word of the week or report an issue please email squatchsoftware@outlook.com. " +
        "When suggesting a word please include the word and a description as to what makes it the word of the week. " +
        "You may also optionally include a dedication."

    var imageObj = {
        smallImageUrl: "https://squatchsoftwarecdn.blob.core.windows.net/fetch/wordoftheweeklogosmall.png",
        largeImageUrl: "https://squatchsoftwarecdn.blob.core.windows.net/fetch/wordoftheweeklogosmall.png",
    };

    sessionHandler.emit(':askWithCard', speechOutput, welcomeMessage, cardTitle, cardContent /*, imageObj */ );
}

/*
Returns true if request is made by a preview user 
future: should be common code so move if another skill users.
*/
function IsAlexaPreviewUserRequest(context, sessionHandler) {

    let userId = sessionHandler.event.session.user.userId;
    let previewUser = alexaPreviewUsers[userId];

    if (previewUser) {
        // alexaPreviewUsers

        logger.addProperty(context, "previewUser", previewUser);
        return true;
    }


    return false;
}

/*
Handles the fetchEventsIntent
*/
function fetchEventsIntentHandler(sessionHandler) {
    let sessionState = sessionHandler.handler.state;
    let context = sessionHandler.context;

    var docClient = new AWS.DynamoDB.DocumentClient();

    // Calculate the sequenceId for month normalized to start week of June11th.
    /*
    nextDay.valueOf() - seedDate.valueOf() 
    86400000 per day
    seed date of 6/11/2017 is: 149716440000
    */

    let seedDate = new Date("12/20/2017").valueOf() / 86400000;
    let nowDate = Date.now() / 86400000;

    // normalize to 7  day sequenes
    let sequenceId = parseInt((nowDate - seedDate) / (7)) + 1;

    // if preview user return the word for next week.
    /*
    if (IsAlexaPreviewUserRequest(context, sessionHandler)) {
        sequenceId = sequenceId + 1;
    }
    */

    logger.addProperty(context, "sequenceId", sequenceId);

    var params = {
        TableName: "dbWorkOfWeek",
        KeyConditionExpression: "#SequenceId = :SequenceId",
        ExpressionAttributeNames: {
            "#SequenceId": "SequenceId"
        },
        ExpressionAttributeValues: {
            ":SequenceId": sequenceId
        }
    };

    console.log("query: " + JSON.stringify(params));

    docClient.query(params, function(err, result) {

        if (err) {
            logger.addProperty(context, "error", JSON.stringify(err));
            sessionHandler.emit(":tell", "An error occured. Please try again later");
        } else {
            /*
              "Description": "Be the example of the person you want to be"
  "Dedication" : "This word is dedicated to Frank for being a good example"
  "SequenceId": 0,
  "Word": "Example"
  */

            let dbItem = result.Items[0];
            let word = dbItem.Word;
            let description = dbItem.Description;
            let dedication = dbItem.Dedication;


            // Todo: mix up the preamble lead up to the word of the week.
            // todo: have more than one
            let preamble = "The word of the week is"

            let wordOfWeekSpeech = "<s>" + preamble + "</s><break time='1ms'/>" +
                "<s><emphasis level='moderate'>" + word + "</emphasis></s><break time='750ms'/>";

            if (description) {
                wordOfWeekSpeech += "<s>" + description + "</s>";
            }

            if (dedication) {
                wordOfWeekSpeech += "<s>" + dedication + "</s>";
            }

            sessionHandler.emit(":tell", wordOfWeekSpeech);
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
        "AlexaRequest": "TheWordOfTheWeek",
        "intent": requestIntent,
        "responseData": piiScrubbedResponse,
        "properties": properties
    }

    logger.log(context, JSON.stringify(alexaData));
}
var Alexa = require('alexa-sdk');
var jwt = require("jwt-simple");
var moment = require('moment');

var logger = require('../common/logger');
var config = require('../common/config');
var fetchRecorder = require("./diagnostics/fetchRecorder.js");

var amazonDateTime = require("./amazonDateTime");
var graph = require("./graph");

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
            logServiceResponse(context, response);

            contextCaller.succeed(response);
        },
        fail: function(response) {
            fetchRecorder.recordEvent(context, "serviceResponseFail", response);
            fetchRecorder.persistRecording(context);

            logServiceResponse(context, response);

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
    alexaHandler = Alexa.handler(event, context);

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
            output = "You must have an account linked to use this skill. Please use the Alexa app to link an account.";
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
        output = welcomeMessage;
        this.emit(':ask', output, welcomeMessage);
    },

    'AMAZON.NoIntent': function() {
        this.emit(':tell', shutdownMessage);
    },

    'AMAZON.RepeatIntent': function() {
        this.emit(':ask', output, helpMessage);
    },

    'fetchEventsIntent': function() {
        var parent = this;
        fetchEventsIntentHandler(this);
    },

    'AMAZON.HelpIntent': function() {
        output = helpMessage;
        this.emit(':ask', output, output);
    },

    'AMAZON.StopIntent': function() {
        this.emit(':tell', killSkillMessage);
    },

    'AMAZON.CancelIntent': function() {
        this.emit(':tell', killSkillMessage);
    },

    'SessionEndedRequest': function() {
        this.emit('AMAZON.StopIntent');
    },

    'Unhandled': function() {
        this.emit(':ask', helpMessage, helpMessage);
    }
});

/*
Handles the fetchEventsIntent
*/
function fetchEventsIntentHandler(sessionHandler) {
    var sessionState = sessionHandler.handler.state;

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

    var accessToken = sessionHandler.event.session.user.accessToken;
    if (!accessToken) {
        output = "You must have an account linked to use this skill. Please use the Alexa app to link an account.";
        sessionHandler.emit(":tellWithLinkAccountCard", output, output);
        return;
    }


    // by default if don't find any messages go back to default state
    sessionHandler.handler.state = null;
    graph.getMailBoxSettingsTimeZone(sessionHandler, function(err, timeZoneName) {
        if (null != err) {
            var output = "An error occured getting Calendar timezone information. " + err.message;
            sessionHandler.emit(verb, output, output);
        } else {
            // Read slot data and parse out a usable date 
            var eventDate = amazonDateTime.getCalendarStartEndTimes(sessionHandler.event.request.intent.slots, timeZoneName);
            // use the timestamp from Amazon as the current time as the user.
            var currentUserTime = moment.tz(sessionHandler.event.request.timestamp, timeZoneName);
            // Check we have both a start and end date
            if (eventDate.startDate && eventDate.endDate) {
                // check if the endDate is in the past then no point in hitting Graph
                if (currentUserTime > moment.tz(eventDate.endDate, timeZoneName)) {
                    sessionHandler.emit(verb, "<s>I am sorry, I cannot answer questions for events in the past</s>", welcomeMessage);
                    return;
                }

                graph.getCalendarView(sessionHandler, eventDate.startDate, eventDate.endDate, timeZoneName, accessToken, function(err, data) {
                    if (null != err) {
                        var output = "<s>You must have an account linked to use this skill. Please use the Alexa app to link an account</s>";
                        sessionHandler.emit(verb, output, output);
                        return;
                    }

                    var relevantEvents = data;

                    // Categorize events  into past, inprogress and future.
                    // This code is relying on the times being sorted when returned from the Graph call.
                    var past = new Array();
                    var inprogress = new Array();
                    var future = new Array();

                    // Categorize if events in past, inProgress or future based on currentUserTime.
                    var timeForCategorization = currentUserTime;

                    for (var i = 0; i < relevantEvents.length; i++) {
                        var event = relevantEvents[i];
                        var start = new moment.tz(event.start, timeZoneName);
                        var end = new moment.tz(event.end, timeZoneName);

                        // meeting is in the future if startTime is >= the current time.
                        if (start >= timeForCategorization) {
                            future.push(event);
                        } else if (timeForCategorization >= start && timeForCategorization < end) {
                            inprogress.push(event);
                        } else {
                            past.push(event);
                        }
                    }

                    var isForToday = moment.tz(eventDate.startDate, timeZoneName).format("MMDDYYY") ==
                        currentUserTime.format("MMDDYYY");
                    var isMultiDayQuery = moment.tz(eventDate.startDate, timeZoneName).format("MMDDYYY") !=
                        moment.tz(eventDate.endDate, timeZoneName).format("MMDDYYY");

                    // Flags to determine what dispatch functions should handle the response.
                    var fetchEventDialogFlags = {
                        "isToday": isForToday,
                        "isMultiDayQuery": isMultiDayQuery,
                        "hasInProgress": inprogress.length > 0,
                        "hasFuture": future.length > 0,
                        "hasPast": past.length > 0,
                        "hasFriendlyName": (eventDate["friendlyName"]) ? true : false,
                        "startDateIsFullDay": (moment.tz(eventDate.startDate, timeZoneName).hour() == 0) ? true : false,
                    }

                    // Context to pass to dispatch functions.
                    var fetchEventsDialogContext = {
                        "sessionHandler": sessionHandler,
                        "currentUserTime": currentUserTime,
                        "timeZoneName": timeZoneName,
                        "startDate": eventDate.startDate,
                        // String appropriate for in a Tell for the day .
                        "startDateDayTellString": (eventDate.startDate) ? moment.tz(eventDate.startDate, timeZoneName).format("dddd, MMMM DD") : null,
                        "endDate": eventDate.endDate,
                        "pastEvents": past,
                        "inProgressEvents": inprogress,
                        "futureEvents": future,
                        "friendlyName": eventDate["friendlyName"],

                        // Items also in the calendarTruthTable. 
                        "isToday": isForToday,
                        "isMultiDayQuery": isMultiDayQuery,
                    }

                    // Find a matching entry.
                    var dispatchFunction = null;
                    for (var tableEntryKey in fetchEventsServiceResponse) {
                        var tableEntry = fetchEventsServiceResponse[tableEntryKey];
                        var tableEntryProperties = tableEntry.properties;
                        var haveMatch = true;
                        for (var tableProperty in tableEntryProperties) {
                            if (tableEntryProperties[tableProperty] != fetchEventDialogFlags[tableProperty]) {
                                haveMatch = false;
                                break;
                            }
                        }

                        if (haveMatch) {
                            dispatchFunction = tableEntry["dispatch"];
                            break;
                        }
                    }

                    if (dispatchFunction) {
                        dispatchFunction(fetchEventsDialogContext);
                        return;
                    }

                    // if no dispatchFunction found then indicate to the user we didn't understand the request.
                    sessionHandler.emit(":tell", "<s>Currently this request is not supported</s>");
                });
            }
        }
    });
}

/*
DialogResponse object for determining and handling the service responses dialog for a fetchEventsMode request.
*/
var fetchEventsServiceResponse = {

    /* table entries for handling when no events in specified date range */
    "noEventsSingleDay": {
        "properties": {
            // "isToday": ,
            "hasFriendlyName": false,
            "isMultiDayQuery": false,
            "hasInProgress": false,
            "hasFuture": false,
            "startDateIsFullDay": true
                // "hasPast": 
        },

        "dispatch": function(fetchEventContext) {
            var dateString = (fetchEventContext.isToday) ? "today" : fetchEventContext.startDateDayTellString;
            var moreString = fetchEventContext.pastEvents.length > 0 ? "more " : "";
            fetchEventContext.sessionHandler.emit(':tell', "<s>There are no " + moreString + "events scheduled for " + dateString + "</s>");
        }
    },
    "noEventsTodayWithFriendlyName": {
        "properties": {
            "isToday": true,
            "hasFriendlyName": true,
            "isMultiDayQuery": false,
            "hasInProgress": false,
            "hasFuture": false,
            //  "startDateIsFullDay":
            //  "hasPast": 
        },

        "dispatch": function(fetchEventContext) {
            var moreString = fetchEventContext.pastEvents.length > 0 ? "more " : "";
            fetchEventContext.sessionHandler.emit(':tell', "<s>There are no " + moreString + "events scheduled for this " +
                fetchEventContext.friendlyName + "</s>");
        }
    },
    "noEventsOnDayWithFriendlyName": {
        "properties": {
            "isToday": false,
            "hasFriendlyName": true,
            "isMultiDayQuery": false,
            "hasInProgress": false,
            "hasFuture": false,
            //  "startDateIsFullDay": 
            // "hasPast": 
        },

        "dispatch": function(fetchEventContext) {
            var moreString = fetchEventContext.pastEvents.length > 0 ? "more " : "";
            fetchEventContext.sessionHandler.emit(':tell', "<s>There are no " + moreString + "events scheduled in the " +
                fetchEventContext.friendlyName + " of " + fetchEventContext.startDateDayTellString + "</s>");
        }
    },

    // Default entry for no events that are currently in progress or in the future.
    "noEventsDefault": {
        "properties": {
            // "isToday": ,
            // "hasFriendlyName": ,
            //  "isMultiDayQuery": ,
            "hasInProgress": false,
            "hasFuture": false,
            //  "startDateIsFullDay": 
            // "hasPast": 
        },

        "dispatch": function(fetchEventContext) {
            var moreString = fetchEventContext.pastEvents.length > 0 ? "more " : "";
            fetchEventContext.sessionHandler.emit(':tell', "<s>There are no " + moreString + "events scheduled</s>");
        }
    },

    /* -- end table entries for handling when no events in specified date range */

    /* generic handling of events if no other matches. */
    /* Note relies on the "noEventsDefault" having priority so there is at least one future 
    or one current in progress event
    */
    "listEvents": {
        "properties": {
            // "isToday": ,
            // "hasFriendlyName": ,
            //  "isMultiDayQuery": ,
            // "hasInProgress": ,
            // "hasFuture": ,
            //  "startDateIsFullDay": 
            // "hasPast": 
        },

        "dispatch": function(fetchEventContext) {

            var outputText = "<s>";

            // If "Today" or have a friendly name not across multiple days then
            // prefix the text with it.
            if (fetchEventContext.isToday && !fetchEventContext.isMultiDayQuery) {
                var dateFriendlyName = fetchEventContext.friendlyName;
                if (dateFriendlyName) {
                    outputText += "This " + dateFriendlyName + " ";
                } else {
                    outputText += "Today "
                }
            }

            /* state remanining if there have been or current events in progress withing the date range */
            var useRemainingInText = (fetchEventContext.pastEvents.length > 0) ||
                (fetchEventContext.inProgressEvents.length > 0);

            // state how many remaining.
            if (fetchEventContext.futureEvents.length == 0) {
                if (useRemainingInText) {
                    outputText += "there are no events remaining";
                } else {
                    outputText += "there are no events";
                }
            } else if (fetchEventContext.futureEvents.length == 1) {

                if (useRemainingInText) {
                    outputText += "there is one more event remaining";
                } else {
                    outputText += "there is one event";
                }

            } else {
                if (useRemainingInText) {
                    outputText += "there are " + fetchEventContext.futureEvents.length + " more events remaining";
                } else {
                    outputText += "there are " + fetchEventContext.futureEvents.length + " events";
                }
            }

            // add on the count for in progress.
            if (fetchEventContext.inProgressEvents.length > 0) {
                if (fetchEventContext.inProgressEvents.length == 1) {
                    outputText += " and there is one event in progress";
                } else {
                    outputText += " and there are " + fetchEventContext.inProgressEvents.length + " events in progress";
                }
            }

            // close the first sentence.
            outputText += "</s>";

            // Check if any in progress and if os print them out.                         
            if (fetchEventContext.inProgressEvents.length > 0) {

                // Set the first prefix based on how many events are in progress.
                var prefix;
                if (fetchEventContext.inProgressEvents.length == 1) {
                    prefix = "The event in progress is ";
                } else {
                    prefix = "The " + fetchEventContext.inProgressEvents.length + " events in progress are ";
                }

                for (var i = 0; i < fetchEventContext.inProgressEvents.length; i++) {
                    var curEvent = fetchEventContext.inProgressEvents[i];
                    outputText += "<s>";
                    outputText += prefix;
                    outputText += curEvent.summary;
                    outputText += "</s>";
                    prefix = " and "
                }
            }

            // Now loop through the future events.
            if (fetchEventContext.futureEvents.length > 0) {

                var lastAnnounceStartTime = fetchEventContext.currentUserTime; // set announce start time to current user request.
                var prefix = (fetchEventContext.inProgressEvents.length > 0) ? "and then " : "";

                // if the day needs to be called out because multiple days override the prefix.
                // add the day if the day switches form the previous.
                for (var i = 0; i < fetchEventContext.futureEvents.length; i++) {

                    var curEvent = fetchEventContext.futureEvents[i];

                    // if the event is on a different day
                    var isSameDay = (null != lastAnnounceStartTime) && (moment.tz(curEvent.start, fetchEventContext.timeZoneName).format("MMDDYYY") ==
                        lastAnnounceStartTime.format("MMDDYYY"));

                    outputText += "<s>";

                    if (!isSameDay) {
                        prefix = "On " + moment.tz(curEvent.start, fetchEventContext.timeZoneName).format("dddd, MMMM DD") + " ";
                        lastAnnounceStartTime = moment.tz(curEvent.start, fetchEventContext.timeZoneName);
                    }

                    outputText += prefix;
                    outputText += (curEvent.isAllDay) ? "all day" : "at " + moment.tz(curEvent.start, fetchEventContext.timeZoneName).format("hh:mm A");
                    outputText += " there is ";
                    outputText += curEvent.summary;
                    outputText += "</s>";
                    prefix = "and ";
                }
            }

            fetchEventContext.sessionHandler.emit(':tell', outputText);
        }
    },
}


/*
Logs the service reequest with any Personal information removed.
*/
function logServiceRequest(context, event) {
    // clone the original object so can log pii scrubbed data.
    var piiScrubbed = JSON.parse(JSON.stringify(event));

    // stub out PII info.
    if (piiScrubbed.session.user.accessToken) {
        var accessToken = piiScrubbed.session.user.accessToken;
        var decoded = jwt.decode(accessToken, "", true);
        piiScrubbed.session.user.upn = decoded.upn;
        // get debugging data from the accessToken.

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
function logServiceResponse(context, response) {
    var piiScrubbedResponse = JSON.parse(JSON.stringify(response));


    // Future: should have markers or another PII build string as the response is made
    //  we can log out to give the part of the response the doesn't have Customer eventData.
    if (piiScrub) {
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

    logger.log(context, JSON.stringify(piiScrubbedResponse));
}
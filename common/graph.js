"use strict";

var MicrosoftGraph = require("@microsoft/microsoft-graph-client").Client;
var moment = require('moment');
var momentTime = require('moment-timezone');
var timezone = require('../common/timezone.js');

var fetchRecorder = require("../common//fetchRecorder.js");

/*
Wraps calls to Microsoft Graph
*/

/*
setMicrosoftGraph allows caller to overide default MicrosoftGraph package.
This is used by the unit tests to stub out calls to Microsoft Graph.
*/
exports.setMicrosoftGraph = function(graph) {
    MicrosoftGraph = graph;
};

/*
getMicrosoftGraph client
*/
exports.getMicrosoftGraph = function() {
    return MicrosoftGraph;
}


/*
Returns a GraphClient for making a request to Microsoft Graph
*/

function getGraphClient(accessToken) {
    // Get a graph client.
    const client = MicrosoftGraph.init({
        defaultVersion: 'v1.0',
        debugLogging: false,
        authProvider: (done) => {
            done(null, accessToken);
        }
    });

    return client;
};

/*
Returns the timeZone of the User's mail settings.
Future: currently need this because Amazon does not provide a way to get the Alexa timezone; switch if they ever do
*/
exports.getMailBoxSettingsTimeZone = function getMailBoxSettingsTimeZone(context, accessToken, callback) {

    if (!accessToken) {
        var err = {
            statusCode: 403,
            message: "no access token"
        }

        callback(err, null);
        return;
    }

    var client = getGraphClient(accessToken);

    var request = client.api('/me/mailboxSettings')
        .select("timeZone");

    var url = request.buildFullUrl();

    fetchRecorder.recordEvent(context, "graphMailBoxSettingsRequest", url);
    request.get((err, res) => {

        fetchRecorder.recordEvent(context, "graphMailBoxSettingsResponseError", err);
        fetchRecorder.recordEvent(context, "graphMailBoxSettingsResponse", res);

        if (err) {
            callback(err, null);
        } else {
            var windowsTimeZone = res.timeZone;
            callback(null, windowsTimeZone);

        }
    })
};

/* 
Queries the Microsoft Graph and returns test that describes the events
that can be spoken to the user.
Future: consider instead of passing a FriendlyName build the friendly Name from start/enddate.
*/
exports.getCalendarEventsOutputText = function getCalendarEventsOutputText(
    context, accessToken, currentUserTime, startDate, endDate, friendlyName, timeZoneName, callback) {

    var currentUserTimeMoment = moment.tz(currentUserTime, timeZoneName);

    // check if the endDate is in the past then no point in hitting Graph
    if (currentUserTimeMoment > moment.tz(endDate, timeZoneName)) {
        callback(null, "<s>I am sorry, I cannot answer questions for events in the past</s>");
    }

    getCalendarView(context, startDate, endDate, timeZoneName, accessToken, function(err, data) {
        if (null != err) {
            err.message = "<s>An error occured getting your calendar information</s>" + err.message;
            callback(err, null);
            return;
        }

        var relevantEvents = data;

        // Categorize events  into past, inprogress and future.
        // This code is relying on the times being sorted when returned from the Graph call.
        var past = new Array();
        var inprogress = new Array();
        var future = new Array();

        // Categorize if events in past, inProgress or future based on currentUserTime.
        var timeForCategorization = currentUserTimeMoment;

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

        var isForToday = moment.tz(startDate, timeZoneName).format("MMDDYYY") ==
            currentUserTimeMoment.format("MMDDYYY");
        var isMultiDayQuery = moment.tz(startDate, timeZoneName).format("MMDDYYY") !=
            moment.tz(endDate, timeZoneName).format("MMDDYYY");

        // Flags to determine what dispatch functions should handle the response.
        var fetchEventDialogFlags = {
            "isToday": isForToday,
            "isMultiDayQuery": isMultiDayQuery,
            "hasInProgress": inprogress.length > 0,
            "hasFuture": future.length > 0,
            "hasPast": past.length > 0,
            "hasFriendlyName": friendlyName ? true : false,
            "startDateIsFullDay": (moment.tz(startDate, timeZoneName).hour() == 0) ? true : false,
        }

        // Context to pass to dispatch functions.
        var fetchEventsDialogContext = {
            "currentUserTime": currentUserTimeMoment,
            "timeZoneName": timeZoneName,
            "startDate": startDate,
            // String appropriate for in a Tell for the day .
            "startDateDayTellString": (startDate) ? moment.tz(startDate, timeZoneName).format("dddd, MMMM DD") : null,
            "endDate": endDate,
            "pastEvents": past,
            "inProgressEvents": inprogress,
            "futureEvents": future,
            "friendlyName": friendlyName,

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

        var outputText;
        if (dispatchFunction) {
            outputText = dispatchFunction(fetchEventsDialogContext);
        } else {
            outputText = "<s>Currently this request is not supported</s>";
        }

        callback(null, outputText);
    });
};

/*
Queries the Microsoft Graph to get the events between the start and end dates
*/
function getCalendarView(context, startDate, endDate, userTimeZone, accessToken, callback) {

    // Get a graph client.
    const client = getGraphClient(accessToken);

    // Build the query
    var request = client
        .api('/me/calendar/calendarView')
        .select("start")
        .select("end")
        .select("subject")
        .select("location")
        .select("bodyPreview")
        .select("isAllDay")
        // .filter(dateFilter + " or " + inprogressFilter)
        .orderby("start/dateTime")
        .query("startDateTime=" + startDate)
        .top(50) // default is 10 make it top 50. Todo: should flag if over 50 (next link) and say something
        .query("endDateTime=" + endDate);

    var url = request.buildFullUrl();
    fetchRecorder.recordEvent(context, "graphcalendarViewRequest", url);


    request.get((err, res) => {

        fetchRecorder.recordEvent(context, "graphcalendarViewResponseError", err);
        fetchRecorder.recordEvent(context, "graphcalendarViewResponse", res);

        if (err) {
            callback(err, null);
        } else {
            var data = new Array();
            for (var k in res.value) {
                var ev = res.value[k];
                var startTime, endTime;

                if (ev.isAllDay) {
                    // For an All Day event the time comes in as midnight to midnight with UTC as the timeZone
                    // even though user's Day is in a different time zone.

                    var startTimeZone = timezone.mapWindowsTimeToOlson(ev.start.timeZone);
                    var endTimeZone = timezone.mapWindowsTimeToOlson(ev.end.timeZone);

                    startTime = moment.tz(ev.start.dateTime, userTimeZone);
                    endTime = startTime.clone().add(24, 'hours');
                } else {
                    var startTimeZone = timezone.mapWindowsTimeToOlson(ev.start.timeZone);
                    var endTimeZone = timezone.mapWindowsTimeToOlson(ev.end.timeZone);
                    startTime = moment.tz(ev.start.dateTime, startTimeZone);
                    endTime = moment.tz(ev.end.dateTime, startTimeZone);
                }
           
                var eventData = {
                    id: ev.id, // unique id of the event
                    summary: (null != ev.subject) ? ev.subject : "no subject",
                    location: (null != ev.location.displayName) ? ev.location.displayName : null,
                    description: (null != ev.bodyPreview) ? ev.bodyPreview : "no body",

                    // start are in a non UTC dateTime format with a timeZone.
                    isAllDay: ev.isAllDay,
                    start: startTime.toJSON(),
                    end: endTime.toJSON(),

                };

                // Graph will return meetings that end at the start time. We want to consider these as not 
                // within the query range so check
                if (eventData.end <= startDate) {
                    continue;
                }

                // add the newly created object to an array for use later.
                data.push(eventData);
            }

            callback(null, data);
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
            return "<s>There are no " + moreString + "events scheduled for " + dateString + "</s>";
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
            return "<s>There are no " + moreString + "events scheduled for this " +
                fetchEventContext.friendlyName + "</s>";
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
            return "<s>There are no " + moreString + "events scheduled in the " +
                fetchEventContext.friendlyName + " of " + fetchEventContext.startDateDayTellString + "</s>";
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
            return "<s>There are no " + moreString + "events scheduled</s>";
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
                    if (curEvent.location)
                    {
                        outputText += "</s><s>The meeting location is " + curEvent.location;
                    }
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
                    if (curEvent.location)
                    {
                        outputText += "</s><s>The meeting location is " + curEvent.location;
                    }
                    outputText += "</s>";
                    prefix = "and ";
                }
            }

            return outputText;
        }
    },
}
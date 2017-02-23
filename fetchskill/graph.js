"use strict";

var MicrosoftGraph = require("@microsoft/microsoft-graph-client").Client;
var moment = require('moment');
var momentTime = require('moment-timezone');
var timezone = require('../common/timezone.js');

var fetchRecorder = require("./diagnostics/fetchRecorder.js");

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
exports.getMailBoxSettingsTimeZone = function getMailBoxSettingsTimeZone(sessionHandler, callback) {
    const timeZoneAttributeName = "timeZone";

    // check if already a value in the state handler and if so use the
    var timeZone = sessionHandler.attributes[timeZoneAttributeName];
    if (timeZone) {
        // If already have a time zone just return it
        callback(null, timeZone);
    } else {
        var accessToken = sessionHandler.event.session.user.accessToken;

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

        fetchRecorder.recordEvent(sessionHandler.context, "graphMailBoxSettingsRequest", url);
        request.get((err, res) => {

            fetchRecorder.recordEvent(sessionHandler.context, "graphMailBoxSettingsResponseError", err);
            fetchRecorder.recordEvent(sessionHandler.context, "graphMailBoxSettingsResponse", res);

            if (err) {

                callback(err, null);
            } else {
                // Graph returns the time zone with windows names such as 'Pacific Standard Time'.
                // This needs to be converted to be used in node.
                var windowsTimeZone = res.timeZone;
                var timeZone = timezone.mapWindowsTimeToOlson(windowsTimeZone);

                if (!timeZone) {
                    callback("unable to map windowTimeZone " + windowsTimeZone);
                } else {
                    sessionHandler.attributes[timeZoneAttributeName] = timeZone;
                    callback(null, timeZone);
                }
            }
        })
    }
};

/*
Queries the Microsoft Graph to get the events between the start and end dates
*/
exports.getCalendarView = function getCalendarView(sessionHandler, startDate, endDate, userTimeZone, accessToken, callback) {

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
    fetchRecorder.recordEvent(sessionHandler.context, "graphcalendarViewRequest", url);


    request.get((err, res) => {

        fetchRecorder.recordEvent(sessionHandler.context, "graphcalendarViewResponseError", err);
        fetchRecorder.recordEvent(sessionHandler.context, "graphcalendarViewResponse", res);

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
                    location: (null != ev.location.displayName) ? ev.location.displayName : "no location",
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
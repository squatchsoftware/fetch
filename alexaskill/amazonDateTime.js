"use strict";

var moment = require('moment');

/*
Given a date slot returns the date range.
Typically this is a single Date such as 2017-02-15" but can be a range
if user asked for "this Weekend" or "Next week".
Future: Inforation on Amazon Date seem to indicate this is an ISO-8601 format but haven't found a package
  that will parse these directly.
*/
function getAmazonDateValueRange(dateValue, timeZoneName) {
    var dateSlotRange = {
        startDateTime: null, // starting dateTime as a moment object
        endDateTime: null, // moment Ending date time. will be null if only a startDateTime
        friendlyName: null, // set to week, weekend, etc. to help with dialog returned back to user.
        errorMessage: null // set if an error occured parsing the dateValue.
    };

    var rawDate = dateValue;

    // check if no dateValue then use the current time.
    if (!rawDate) {
        // if no time of day specified then startDateTime as "now". 
        dateSlotRange.startDateTime = new moment.tz(timeZoneName);
        return dateSlotRange;
    }

    // if have a dateValue then see if can parse the normal YYYY-MM-DD.
    // Ideally could use moment for this but moment is trating the weekend type dates as valid
    // so use date.parse to determine but then need to use moment for the proper time zone.
    if (Date.parse(rawDate)) {
        dateSlotRange.startDateTime = new moment.tz(rawDate, "YYYY-MM-DD", timeZoneName)
        return dateSlotRange;
    }

    // check if this could be a weekend or weekday item.
    var res = rawDate.split("-");

    // if we have 2 bits that include a 'W' week number
    if (res.length === 2 && res[1].indexOf('W') > -1) {
        dateSlotRange.startDateTime = new moment.tz(rawDate, "YYYY-[W]WW", timeZoneName);
        dateSlotRange.endDateTime = dateSlotRange.startDateTime.clone().add(7, 'days');
        dateSlotRange.friendlyName = "week";
    } else if (res.length === 3) {
        // "GGGG-[W]WW-WE"
        dateSlotRange.startDateTime = new moment.tz(rawDate, "YYYY-[W]WW[-WE]", timeZoneName);
        dateSlotRange.startDateTime.add(5, 'days');
        dateSlotRange.endDateTime = dateSlotRange.startDateTime.clone().add(2, 'days');
        dateSlotRange.friendlyName = "weekend";
    }

    // Check the startDateTime if its null or invalid then return an error.
    if (null == dateSlotRange.startDateTime || !dateSlotRange.startDateTime.isValid()) {
        dateSlotRange.errorMessage = "unable to parse Date:" + rawDate;
        dateSlotRange.startDateTime = null;
        dateSlotRange.endDateTime = nuill;
    }

    return dateSlotRange;
}

/* 
Returns an hour range for an amazon time.
a range can happen if user asks for "afternoon", "morning"
*/

function getAmazonTimeValueRange(timeValue, timeZoneName) {

    var timeSlotRange = {
        startTimeHour: null, // starting dateTime as a moment object
        startTimeMinutes: null, // starting dateTime as a moment object
        endTimeHour: null, // moment Ending date time. will be null if only a startDateTime
        endTimeMinutes: null, // moment Ending date time. will be null if only a startDateTime
        friendlyName: null, // set to week, weekend, etc. to help with dialog returned back to user.
        errorMessage: null // set if an error occured parsing the dateValue.
    };

    // check if have hours to set. 
    // time is in 24 hour format.
    var calendarTime = timeValue;
    var calendarTimeParsed = new moment.tz(calendarTime, "HH:mm", timeZoneName);
    if (calendarTimeParsed.isValid()) {
        // Future: be nice to distinguish between no time set vs. parse error.
        // if valid set the start and end time hours to be what is set
        var momentObj = calendarTimeParsed.toObject();
        var hour = momentObj.hours;
        var minutes = momentObj.minutes;

        // if exact time is given use the time as the start time  hour and minutes
        timeSlotRange.startTimeHour = hour;
        timeSlotRange.startTimeMinutes = minutes;
        return timeSlotRange;
    }

    // if not HH:mm probably "Afternoon", "Morning.". go ahead and check.
    // night: NI, morning: MO, afternoon: AF, evening: EV.
    // future: should probably check this before the parse.
    switch (calendarTime) {
        case 'MO': // morning
            timeSlotRange.startTimeHour = 0;
            timeSlotRange.startTimeMinutes = 0;
            timeSlotRange.endTimeHour = 12;
            timeSlotRange.endTimeMinutes = 0;
            timeSlotRange.friendlyName = "morning";
            break;
        case 'AF': // afternoon
            timeSlotRange.startTimeHour = 12;
            timeSlotRange.startTimeMinutes = 0;
            timeSlotRange.endTimeHour = 18;
            timeSlotRange.endTimeMinutes = 0;
            timeSlotRange.friendlyName = "afternoon";
            break;
        case 'EV': // evening
        case 'NI': // night
            timeSlotRange.startTimeHour = 17;
            timeSlotRange.startTimeMinutes = 0;
            timeSlotRange.endTimeHour = 23;
            timeSlotRange.endTimeMinutes = 59;
            timeSlotRange.friendlyName = "evening";
            break;
    }

    // if no startTimeHour then return an errorMessage
    if (null == timeSlotRange.startTimeHour) {
        timeSlotRange.errorMessage = "unable to parse Time:" + calendarTime;
    }

    return timeSlotRange;
}

/*
Parses the Datetime information sent to the skill.

Example:
    "slots": {
        "date": {
            "name": "date",
            "value": "2017-02-15"
        },
        "time": {
            "name": "time"
        }
*/


exports.getCalendarStartEndTimes = function getCalendarStartEndTimes(slots, timeZoneName) {

    // The date is going to come in local time of where the alexa device is.
    // create an empty object to use later
    var eventDate = {

    };


    var dateRange = getAmazonDateValueRange(slots.date.value, timeZoneName);
    var timeRange = getAmazonTimeValueRange(slots.time.value, timeZoneName);

    var startDateTime = dateRange.startDateTime;
    var endDateTime = dateRange.endDateTime;
    var dateTimeFriendlyName = dateRange.friendlyName;
    var errorMessage = dateRange.errorMessage; // Future: currently not using.

    // if there is a time range we may need to update the times in the dateTime.
    if (null != timeRange.startTimeHour) {

        // If already have an endDateTime then leave as is since Date had a range
        // Future review if can have a better time range from Alexa.
        if (null == endDateTime) {
            // Update the startdateTime to the be the timeRange.
            startDateTime.set('hour', timeRange.startTimeHour);
            startDateTime.set('minute', timeRange.startTimeMinutes);

            // If have an end time hour then set it to be the endDatetime.
            if (null != timeRange.endTimeHour) {
                // use the startDateTime and then set the hour to be the end time range.
                endDateTime = startDateTime.clone();
                endDateTime.set('hour', timeRange.endTimeHour);
                endDateTime.set('minute', timeRange.endTimeMinutes);

                // 
            }

            // transfer over any friendly name from the time.
            dateTimeFriendlyName = timeRange.friendlyName;
        }
    }

    // if no endDateTime then set to the end of the days
    // if still no endDateTime then set to the end of day
    if (!endDateTime) {
        endDateTime = new moment.tz(startDateTime, timeZoneName);
        endDateTime.set('hour', 23);
        endDateTime.set('minute', 59);
    }

    eventDate["startDate"] = startDateTime.toJSON();
    eventDate["endDate"] = endDateTime.toJSON();
    eventDate['friendlyName'] = dateTimeFriendlyName;

    return eventDate;
}
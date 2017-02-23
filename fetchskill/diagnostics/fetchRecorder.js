"use strict";

var fs = require('fs');
var jwt = require("jwt-simple");
var crypto = require('crypto');

var config = require('../../common/config');

// Globals

// Set enableFetchRecorder to true for recording to be enabled.
var enableFetchRecorder = config.settings("enableFetchRecorder");

// output directory to use for persisting Recordings.
var recorderOutputDirectory = config.settings("recorderOutputDirectory");

// EventNames
var serviceRequestEvent = "serviceRequest";

/*
 Class that can be turned on during a service request to record information so request
 can be played back in unit tests.
*/
class FetchRecorder {

    constructor() {
        this.recordedEvents = {};
    }

    /*
        Records an event and value.
        If there is already an event with a matching name it is replaced.
    */
    recordEvent(propertyName, propertyValue) {

        // Clone the property value since it may change if object updated
        // later.
        propertyValue = JSON.parse(JSON.stringify(propertyValue));
        this.recordedEvents[propertyName] = propertyValue;
    }

    /*
        Persists a recording to a local file
    */
    persistRecording() {

        // Create a name for the persiste file using a hash of the service request and response properties
        // and partial name of the request text.
        var serviceRequest = this.recordedEvents[serviceRequestEvent];

        // Independent of the recording have the user be Squatch.
        if (serviceRequest.session &&
            serviceRequest.session.user &&
            serviceRequest.session.user.accessToken
        ) {
            var accessToken = serviceRequest.session.user.accessToken;
            var decoded = jwt.decode(accessToken, "", true);
            decoded.app_displayname = "fetch";
            decoded.family_name = "Squatch Software";
            decoded.given_name = "Squatch";
            decoded.ipaddr = "10.0.0.1";
            decoded.name = "Squatch Software";
            decoded.unique_name = "squatchycode@squatchsoftware.com"
            decoded.upn = "squatchycode@squatchsoftware.com";
            var encoded = jwt.encode(decoded, "key");

            // Update the original accessToken values.
            serviceRequest.session.user.accessToken = encoded;
        }

        // Build a friendly name from the 
        var fileName = "recorder"; // use recorder as a default
        var request = serviceRequest.request;
        var intent = request.intent;
        if (intent) {
            if ("searchIntent" == intent.name) {
                /*
                request":{"type":"
                    IntentRequest","requestId":"EdwRequestId.5d973d27-84f8-4554-b6f3-aaf6721c97df",
                    "timestamp":"2017-02-15T08:38:04Z",
                    "locale":"en-US",
                    "intent":{"name":"searchIntent","slots":{"date":{"name":"date","value":"2017-02-15"},"time":{"name":"time"}}},"inDialog":false}},
                */
                var inDialog = request.inDialog;
                var locale = request.locale;

                var dateName = intent.slots.date.name;
                var dateValue = intent.slots.date.value;
                var timeName = intent.slots.time.name;
                var timeValue = intent.slots.time.value;

                fileName = intent.name +
                    locale +
                    dateValue +
                    ((timeValue) ? timeValue : "") +
                    ((inDialog) ? "inDialog" : "");

                fileName = encodeURIComponent(fileName);

            }
        }

        // Make a hash of the object being recorded so each recording gets a different name even if input intent is the 
        // Same.
        var recorderEventsHash = this.hash(JSON.stringify(this.recordedEvents));

        fileName += "_" + recorderEventsHash + ".json";

        // fileName could have characters that need to be encoded to have be a valid fileName
        fileName = encodeURIComponent(fileName);

        // build the output file path.
        var outputFile = recorderOutputDirectory + fileName;


        // write out the unit Test object to a file if recording is on.
        fs.writeFileSync(outputFile, JSON.stringify(this.recordedEvents));
    }


    /*
    Helper method to make a hash of a string.
     */
    hash(data) {
        return crypto.createHash("md5").update(data).digest("base64");
    }

};

/* 
Attaches an instance of the recorder to the given parent object
*/
exports.attach = function attach(parent) {

    // Only attach if recording is turned on.
    if (enableFetchRecorder) {
        // todo: make a default name.
        var recorder = new FetchRecorder();
        parent.fetchRecorder = recorder;
    }
}

/*
Records the event if there is a fetchRecorder set
*/
exports.recordEvent = function recordEvent(parent, eventName, data) {
    if (parent && parent.fetchRecorder) {
        parent.fetchRecorder.recordEvent(eventName, data)
    }
}

/*
Persists the currently recorded events to a local file on disk
*/
exports.persistRecording = function persistRecording(parent) {
    if (parent && parent.fetchRecorder) {
        parent.fetchRecorder.persistRecording();
    }
}
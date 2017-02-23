"use strict";

var uuid = require('uuid');

class Logger {

    constructor(correlationId) {
        this.correlationId = correlationId;

        this.unitTestObject = {};
    }

    // log method to call.
    log(message) {
        console.log(this.correlationId + ": " + message);
    }
};

/* simple wrapper given a parent object that should have a logger property for the logger
  check if there is a logger instance and if so cal it, else do a console.log
*/

exports.log = function log(parent, message) {
    if (parent && parent.logger) {
        parent.logger.log(message);
    } else {
        console.log(message);
    }
}

exports.attach = function attach(parent) {

    if (parent) {
        if (parent.logger) {
            // There is already a logger so just return.
            return parent.logger;
        }

        // if no logger yet create one.
        parent.logger = new Logger(uuid.v1());
        return parent.logger;
    }
}

exports.Logger = Logger;
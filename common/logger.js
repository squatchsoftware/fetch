"use strict";

var uuid = require('uuid');

class Logger {

    constructor(correlationId) {
        this.correlationId = correlationId;

        this.unitTestObject = {};
        this.propertyBag = {};
    }

    // log method to call.
    log(message) {
        console.log(this.correlationId + ": " + message);
    }

    // Add Property to the property bag.
    // Future: consider adding specific methods for common properties such as "error"
    addProperty(name, value) {
        this.propertyBag[name] = value;
    }

    /*
    Get the property value for the given property name
    */
    getProperty(name) {
        return this.propertyBag[name];
    }


    // Gets the propery bag collection.
    getPropertyies() {
        return this.propertyBag;
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

exports.addProperty = function addProperty(parent, name, value) {
    if (parent && parent.logger) {
        parent.logger.addProperty(name, value);
    } else {
        console.log("Unable to add property. No logger was found on the parent object.");
    }
}

exports.getProperty = function getProperty(parent, name) {
    if (parent && parent.logger) {
        return parent.logger.getProperty(name);
    } else {
        console.log("getProperty: No logger was found on the parent object.");
    }
}

exports.getProperties = function getProperties(parent) {
    if (parent && parent.logger) {
        return parent.logger.getPropertyies();
    } else {
        console.log("Unable to get the logger property bag. No logger was found on the parent object.");
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
"use strict";

var fs = require('fs');
var jsmin = require('jsmin').jsmin;

var configFileData = fs.readFileSync("./config.json", 'utf-8');
var configJson = JSON.parse(jsmin(configFileData));

// See if there is a config.json.user override
var configFileUserOverride = configJson["configUserOverrideFile"];
var configUserJson = null;

if (configFileUserOverride && fs.existsSync(configFileUserOverride)) {
    var configUserFileData = fs.readFileSync(configFileUserOverride, 'utf-8');
    configUserJson = JSON.parse(jsmin(configUserFileData));
}

/*
Configuration information 
*/

exports.settings = function settings(propName) {

    // check environment variable for override
    var propValue = process.env[propName];
    if (undefined == propValue && configUserJson) {
        propValue = configUserJson[propName];
    }
    if (undefined == propValue && configJson) {
        propValue = configJson[propName];
    }

    // if still undefined throw an error
    if (undefined == propValue) {
        throw "unknown config property: " + propName;
    }

    return propValue;
}
"use strict";


/* 
Converts a Json object to Base64.
*/
exports.JsonToBase64 = function JsonToBase64(jObject) {
    var base64 = new Buffer(JSON.stringify(jObject)).toString('base64');
    return base64;
}

/*
Converts Base64 string created with JsonToBase64 back to a Json object
*/
exports.Base64ToJson = function Base64ToJson(base64Object) {
    var jObject = JSON.parse(new Buffer(base64Object, 'base64').toString('utf8'));
    return jObject;
}
"use strict";

/*
Stores path mappings for Mock of GraphRequest client
*/

var pathMappings = {};

/* 
remove all path pathMappings
*/
exports.clearPathMappings = function clearPathMappings() {
    pathMappings = {};
}

/*
Add a path mapping 
*/
exports.addPathMapping = function addPathMapping(url, result, error) {
    pathMappings[url] = {
        "result": result,
        "error": error
    };
}

/*
returns the Graph response previously set with addPathMapping for the given Url.
*/
exports.resolveGraphRequestUrl = function resolveGraphRequestUrl(url, callback) {
    console.log("handling graph Url: " + url)
    var response = pathMappings[url];
    if (response) {
        callback(response.error, response.result);
        return;
    }

    throw "The request graphUrl is not in the pathMappings.";
}
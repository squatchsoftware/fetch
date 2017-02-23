"use strict";
const GraphRequest_1 = require("./GraphRequest");
var pathMappings = require("./pathMappings");

/*
This file is a modified copy from the msgraph-sdk-javascript 
Package version .0.3.2 from https://www.npmjs.com/package/@microsoft/microsoft-graph-client.
Github: https://github.com/microsoftgraph/msgraph-sdk-javascript.
License is MIT: https://github.com/microsoftgraph/msgraph-sdk-javascript/blob/master/LICENSE
*/

/*
Mock of GraphRequest client for unit tests
*/
class Client {

    constructor() {
        this.config = {
            debugLogging: false,
            defaultVersion: "v1.0",
            baseUrl: "https://graph.microsoft.com/"
        };
    }

    static init(clientOptions) {
        var graphClient = new Client();
        for (let key in clientOptions) {
            graphClient.config[key] = clientOptions[key];
        }

        return graphClient;
    }

    api(path) {
        return new GraphRequest_1.GraphRequest(this, this.config, path);
    }
}

exports.Client = Client;

/* exports called by unit tests to setup Urls and response data */

/* 
remove all path pathMappings
*/
exports.clearPathMappings = function clearPathMappings() {
    pathMappings.clearPathMappings();
}

/*
Add a path mapping 
*/
exports.addPathMapping = function addPathMapping(url, result, error) {
    pathMappings.addPathMapping(url, result, error);
}
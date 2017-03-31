"use strict";

var jwt = require("jwt-simple");

var config = require('../common/config');
var base64 = require('../common/base64');
var logger = require('../common/logger');

// Signing Key for jwt tokens.
var authhelper_tokenSigningKey = config.settings("authhelper_tokenSigningKey");

// Issuer for jwt tokens.
var authhelper_tokenIssuer = config.settings("authhelper_tokenIssuer");

/*
Decodes an Access token or one created previously with encodeTokenInformation
*/
exports.decodeTokenInformation = function decodeTokenInformation(access_token) {
    // decode the jwt access_token.
    // This is a fetch token decode verifying signature and expiration date..
    let decodedToken = jwt.decode(access_token, authhelper_tokenSigningKey, false /* noVerify */ );
    return decodedToken;
}

/*
 Encode the access token and id information
 MSA doesn't have the userName in the access_token so store here.
 The Identity token is only provided for a Refresh on the v2.0 endpoint.
*/
exports.encodeTokenInformation = function encodeTokenInformation(context, id_token, access_token) {

    if (!authhelper_tokenSigningKey ||
        "" == authhelper_tokenSigningKey) {
        throw new Error('No token signing key specified in config.');
    }

    var encodedToken = {
        iss: authhelper_tokenIssuer,
    }

    // variables for logging.
    let hasIdToken = false;
    let userNameFromAccessToken = false;

    // try to decode the id_token to populate properties so consistent across token types.
    // and wrap original access_token.
    if (id_token) {

        let decoded = jwt.decode(id_token, "", true);

        // bring over properties want from original token
        hasIdToken = true;
        encodedToken.endpointVersion = decoded.ver;
        encodedToken.exp = decoded.exp;
        encodedToken.iat = decoded.iat;

        // Check if tid:"9188040d-6c67-4c5b-b112-36a304b66dad"  which indicates MSA
        encodedToken.tokenType = (!decoded.tid) ? "NoTid" : (decoded.tid.toLowerCase() == "9188040d-6c67-4c5b-b112-36a304b66dad") ? "MSA" : "AAD";

        // Set the email. This is in the access token for JWT but for MSA we need to remember it.
        encodedToken.preferred_username =
            decoded.preferred_username ? decoded.preferred_username : // v2.0 endpoint should have preferred_username
            decoded.email;

        // AAD tokens don't seem to always have a preferred_username so if not then decode the access_token to get the upn
        if (!encodedToken.preferred_username && "AAD" == encodedToken.tokenType) {
            let accessTokenDecoded = jwt.decode(access_token, "", true);
            encodedToken.preferred_username = accessTokenDecoded.upn;
            userNameFromAccessToken = true;
        }

    } else {
        // The else path is expected for auth v1.0 on refresh token.
        // If switch to v2.0 for all platforms this shouldn't be necessary
        let decoded = jwt.decode(access_token, "", true);

        encodedToken.tokenType = "AAD"
        encodedToken.endpointVersion = "1.0";
        encodedToken.exp = decoded.exp;
        encodedToken.iat = decoded.iat;
        encodedToken.preferred_username = decoded.upn;

        userNameFromAccessToken = true;
    }

    let tokenData = {
        "Token": "",
        email: encodedToken.preferred_username,
        properties: encodedToken,
        hasIdToken: hasIdToken,
        userNameFromAccessToken: userNameFromAccessToken
    }

    logger.log(context, JSON.stringify(tokenData));

    // Add on the original access_token
    // Do this after logging the tokenData so it doesn't include the access token
    encodedToken.access_token = access_token;

    // encode and sign.
    let fetchAccessToken = jwt.encode(encodedToken, authhelper_tokenSigningKey);

    return fetchAccessToken;
}
"use strict";

var jwt = require("jwt-simple");

var config = require('../common/config');
var base64 = require('../common/base64');

// Signing Key for jwt tokens.
var authhelper_tokenSigningKey = config.settings("authhelper_tokenSigningKey");

// Issuer for jwt tokens.
var authhelper_tokenIssuer = config.settings("authhelper_tokenIssuer");

/*
Decodes an Access token or one created previously with encodeTokenInformation
*/
exports.decodeTokenInformation = function decodeTokenInformation(access_token) {

    var segments = access_token.split('.');
    if (segments.length !== 3) {

        // this is deprecated but keep after first deploy until tokens time out
        // if not 3 segments its either an invalid token or was wrapped. 
        let tokenInformation = base64.Base64ToJson(access_token);

        console.log("using obosoleted wrapped token " + JSON.stringify(tokenInformation));
        return tokenInformation;
    }

    // decode the jwt access_token.
    let decoded = jwt.decode(access_token, "", true /* noVerify */ );

    if (authhelper_tokenIssuer == decoded.iss) {
        // this is a fetch token already in the format want but verify the signature is valid.
        return jwt.decode(access_token, authhelper_tokenSigningKey, false /* noVerify */ );
    }

    // We didn't issue so decode the token and fill in the metadata properties.
    // jwt token so create same tokenInfomration that the wrapped token would return.
    let tokenInformation = {

    }

    // access token matches original access token.
    tokenInformation.access_token = access_token;

    // Unwrapped AAD auth v1.0 endpoint.
    tokenInformation.tokenType = "AAD";
    tokenInformation.endpointVersion = decoded.ver;
    tokenInformation.preferred_username = decoded.upn;

    return tokenInformation;
}

/*
 Encode the access token and id information 
 MSA doesn't have the userName in the access_token so store here.
 The Identity token is only provided for a Refresh on the v2.0 endpoint.
*/
exports.encodeTokenInformation = function encodeTokenInformation(id_token, access_token) {

    if (!authhelper_tokenSigningKey ||
        "" == authhelper_tokenSigningKey) {
        throw new Error('No token signing key specified in config.');
    }

    // try to decode the id_token to populate properties so consistent across token types.
    // and wrap original access_token.
    if (id_token) {


        var encodedToken = {
            access_token: access_token
        }

        let decoded = jwt.decode(id_token, "", true);

        console.log("wrapping id token " + JSON.stringify(decoded));

        encodedToken.iss = authhelper_tokenIssuer;

        // bring over properties want from original token
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
            console.log("getting upn from aad token");
            let accessTokenDecoded = jwt.decode(access_token, "", true);
            encodedToken.preferred_username = accessTokenDecoded.upn;
        }

        console.log("fetchToken for " + encodedToken.preferred_username);

        return jwt.encode(encodedToken, authhelper_tokenSigningKey);
    } else {
        // Warning since this is expected for auth v1.0 on refresh token.
        // If switch to v2.0 for all platforms this should be an error.
        console.log("!!Warning - no identity Token");
    }

    // If no id_token just return the original access_token
    return access_token;
}
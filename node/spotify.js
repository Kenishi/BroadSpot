//var http = require('http');

module.exports = {

	// function authorizeURL(client_id, redirect_uri, opts)
	// function getTokens(code, redirect_uri, client_id, client_secret, callback)
	// function refreshTokens(refresh_token, redirect_uri, client_id, client_secret, callback)

	SCOPES : {
		PLAYLIST_READ_PRIVATE : "playlist-read-private",
		PLAYLIST_MODIFY_PUBLIC : "playlist-modify-public",
		PLAYLIST_MODIFY_PRIVATE : "playlist-modify-private",
		USER_READ_PRIVATE : "user-read-private"
	},

	/*
		Request authorization for access to user's spotify.

		client_id : the application key given by Spotify
		redirect_uri : the uri to redirect back to after authorization.
			This must match the domain EXACTLY as it was registered with Spotify.
			The receiving URL will have 2 query values.
				On Success:
					code : auth code used to retrieve tokens
					state : if you supplied a state value, you will get this as well
				On Error:
					error : the reason auth failed
					state : if you supplied a state value, you will get this as well

		opts: Additional options that can be supplied as an object.
			{
				state: a string specified by the app that it can use to verify state
				scopes: an array of scope ids to specify what info to access on the user's account
				show_dialog: boolean to specify whether to show the login screen again
					after the app is verified
			}
	*/
	authorizeURL : function(client_id, redirect_uri, opts) {
		if(!client_id) throw new Error("Client ID is required for authorization");
		if(!redirect_uri) throw new Error("Redirect URI is required for authorization");

		var state = buildStateParam(opts.state);
		var scopes = buildScopeParam(opts.scopes);
		var show_dialog = opts.show_dialog ? buildShowDlgParam(opts.show_dialog) : buildShowDlgParam(false);

		var path = authorize_url.path.replace("{clientid}", client_id)
						.replace("{redirecturi}", redirect_uri)
						.replace("{state}", state)
						.replace("{scope}", scopes)
						.replace("{showdialog}", show_dialog);
		return "//" + authorize_url.domain + path;
	},

	/*
		Get the access token and refresh token
		
		code : the code string returned from authorization
		redirect_uri : the redirect_uri used during authorization. The user won't be redirected, its only
			for validation
		client_id : a string of the apps key id
		client_secret : the string of the apps secret key
		callback : a function(success, object|string) that will be called back on completion.
			On Succes, there will an object
				{
					access_token : the access token
					token_type : how the token can be used, should always be "Bearer"
					expires_in : when the token will expire
					expires_at : estimated time when token will expire
					refresh_token : this token can be used to get new tokens again 
				}
			On Error, expect a string with details
	*/
	getTokens: function(code, redirect_uri, client_id, client_secret, callback) {
		if(!code) throw new Error("Authorization code is required in order to get tokens");
		if(!redirect_uri) throw new Error("Redirect URI is required in order to get tokens");
		if(!client_id) throw new Error("The app id/key is required in order to get tokens");
		if(!client_secret) throw new Error("The app secret key is required in order to get tokens");
		if(!callback || (typeof callback != 'function')) {
			throw new Error("A callback is required to receive the tokens");
		}

		var body = {
			code : code,
			redirect_uri : redirect_uri,
			client_id : client_id,
			client_secret : client_secret
		};
		var body_str = querystring.stringify(body);

		var opts = {
			host : token_url.domain,
			path : path,
			method : 'post',
			headers : {
				"Content-Type" : "application/x-www-form-urlencoded",
				"Content-Length" : body_str.length
			}
		}

		var req = http.request(opts, function(res) {
			var ok = res.statusCode == 200;

			res.on('data', function(chunk) {
				var data = ok ? querystring.parse(chunk) : chunk;
				data.expires_at = new Date(Date.now() + (data.expires_in * 1000 - 5000));
				callback(ok, data);
			});
		});

		req.on('error', function(e) {
			callback(false, e);
		});

		req.write(body_str);
		req.end();
	},

	/*
		Refresh an access token.

		API call is the same as getTokens() except instead of passing in the code
		you pass in the refresh token received in the first getToken()

		Note: Refreshing a token may return a new 'refresh_token' along with a 
			new access_token
	*/
	refreshTokens: function(refresh_token, client_id, client_secret, callback) {
		if(!refresh_token) new Error("A refresh token is required to refresh tokens");
		if(!client_id) new Error("The client id (app key) is required to refresh tokens");
		if(!client_id) new Error("The client secret key is required to refresh tokens");
		if(!callback || typeof callback != 'function') new Error("A callback is required to refresh tokens");

		var body = {
			grant_type : "refresh_token",
			refresh_token : refresh_token,
			client_id : client_id,
			client_secret : client_secret
		};
		var body_str = querystring.stringify(body);

		var opts = {
			domain : token_url.domain,
			path : token_url.path,
			method: 'post',
			headers : {
				"Content-Type" : "application/x-www-form-urlencoded",
				"Content-Length" : body_str.length
			}
		};

		var req = http.request(opts, function(res) {
				var ok = res.statusCode;
				res.on('data', function(chunk) {
					var data = ok ? querystring.parse(chunk) : chunk;
					data.expires_at = new Date(Date.now() + (data.expires_in * 1000 - 5000));
					callback(ok, data);
				});
		});

		req.on('error', function(e) {
			callback(false, e);
		});

		req.write(body_str);
		req.end();
	},
	/*
		Retrieve a user's info.

		Requires Scope: USER_READ_PRIVATE

		Expects:
			token - the token object returned from a getTokens() call
			callback - the callback to receive the user info in.

		On Success:
			Status is set to true and an object with the user info is supplied.
			See URL for object keys: 
				https://developer.spotify.com/web-api/get-current-users-profile/
		On Error:
			Status is set to false and an error message is supplied.
		
		On Expired Tokens:
			If the access token has expires, status will be set to false and
			spotify.TokenExpireError will be in the data.

			A call to refreshTokens() will need to be done before queryUserInfo
			can proceed.
	*/
	queryUserInfo : function(tokens, callback) {
		if(!tokens) throw new Error("tokens required to get user id");
		if(!tokens.access_token) throw new Error("access token required to get user id");
		if(!callback && typeof callback != 'function') throw new Error("callback is required to get user id");

		var valid = (Date.now() - tokens.expires_at) < 0;
		if(!valid) {
			callback(false, this.TokenExpiredError);
		}
		else {
			var opts = {
				domain : api_url.domain,
				path : api_url.path + "me",
				method : "get",
				headers : {
					"Authorization" : "Bearer " + tokens.access_token
				}
			}
			var req = http.request(opts, function(res) {
				var ok = res.statusCode();
				res.on('data', function(chunk) {
					var data = ok ? JSON.parse(chunk) : chunk;
					callback(ok, data);
				});
			});

			req.on('error', function(err) {
				callback(false, err);
			});
			req.end();
		}
	},

	TokenExpiredError : "error: token_expired"
}

var api_url = {
	domain : "api.spotify.com",
	path : "/v1/"
};

var token_url = {
	domain : "accounts.spotify.com",
	path : "/api/token"
};

var authorize_url = { 
	domain : "accounts.spotify.com",
	path : "/authorize/?client_id={clientid}&response_type=cose&redirect_uri={redirecturi}{state}{scope}{showdialog}"
};

function buildShowDlgParam(doShow) {
	if(doShow == undefined || doShow == null) throw new Error("show_dialog cannot be null or undefined");
	return encodeURI("&show_dialog=" + doShow.toString());
}

function buildStateParam(state) {
	if(!state || state.length <= 0) return "";
	return encodeURI("&state=" + state);
}

function buildScopeParam(scopes) {
	if(!scopes || scopes.length <=0) return "";
	
	var out = "&scope=";
	for(var i=0; i < scopes.length; i++) {
		var val = scopes[i];
		var added = false;
		for(key in module.exports.SCOPES) {
			if(val == module.exports.SCOPES[key]) {
				out += val + " ";
				added = true;
				break;
			}
		}
		if(!added) { // Scope not found
			throw new Error(val + " is not a scope in this library.");
		}
	}

	return encodeURI(out);
}
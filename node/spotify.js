//var http = require('http');

var querystring = require('querystring'),
	rest = require('rest'),
	mime = require('rest/interceptor/mime'),
	winston = require('winston'),	
	errors = require('./public/js/errors');

winston.cli();
winston.level = 'input';

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
			client_secret : client_secret,
			grant_type : "authorization_code"
		};

		var opts = {
			path : "https://" + token_url.domain + token_url.path,
			method : 'post',
			entity : body,
			headers : {
				"Content-Type" : "application/x-www-form-urlencoded",
				"Accept" : "application/json"
			}
		}

		var client = rest.wrap(mime);
		client(opts).then(function(response) {
			var data = response.entity;
			data.expires_at = new Date(Date.now() + (parseInt(data.expires_in) * 1000 - 5000));
			callback(true, data);
		})
		.catch(function(errorData) {
			callback(false, errorData);
		});
	},

	/*
		Refresh an access token.

		API call is the same as getTokens() except instead of passing in the code
		you pass in the refresh token received in the first getToken()

		Note: Refreshing a token may return a new 'refresh_token' along with a 
			new access_token
	*/
	refreshTokens: function(refresh_token, client_id, client_secret) {
		if(!refresh_token) new Error("A refresh token is required to refresh tokens");
		if(!client_id) new Error("The client id (app key) is required to refresh tokens");
		if(!client_id) new Error("The client secret key is required to refresh tokens");

		return new Promise(function(resolve, reject) {
			var body = {
				grant_type : "refresh_token",
				refresh_token : refresh_token,
				client_id : client_id,
				client_secret : client_secret,
				grant_type : "authorization_code"
			};

			var opts = {
				path : "https://" + token_url.domain + token_url.path,
				method : 'post',
				entity : body,
				headers : {
					"Content-Type" : "application/x-www-form-urlencoded",
					"Accept" : "application/json"
				}
			}

			var client = rest.wrap(mime);
			client(opts).then(function(response) {
				var data = response.entity;
				data.expires_at = new Date(Date.now() + (parseInt(data.expires_in) * 1000 - 5000));
				resolve(true, data);
			})
			.catch(function(errorData) {
				reject(false, errorData);
			});
		});
	},

	/*
		Retrieve a user's info.

		Requires Scope: USER_READ_PRIVATE

		Expects:
			token - the token object returned from a getTokens() call
			callback - the callback to receive the user info in.
				paramteres:
					status:boolean - success or fail
					data:object | string - result data

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
		if(!callback || typeof callback != 'function') throw new Error("callback is required to get user id");

		var valid = (Date.now() - tokens.expires_at) < 0;
		if(!valid) {
			callback(false, this.TokenExpiredError);
		}
		else {
			var opts = getStubAPIRequest(tokens.access_token, "me");
			opts.method = "get";

			var client = rest.wrap(mime);
			client(opts).then(function(response) {
				var data = response.entity;
				callback(true, data);
			})
			.catch(function(errorData) {
				callback(false, errorData);
			});
		}
	},

	/**
		Add songs to a playlist

		Expects:
			tokens:Object - the tokens received during authorization
					tokens.access_token should be present
			userId:string - the user id (NOT Spotify URI)
			playlistId:string - the playlist id to remove the songs from (NOT Spotify URI)
			trackUris:array - an array of objects containing track URIs
				Format : {
					'trakcs' : [
						{'uri' : <spotify track URI>},
						{'uri' : <spotify track URI>}, ...
					]
				}

		Returns:
			A promise that resolves with 2 parameters

		On Succes:
			status: boolean - set to true
			data: object : { code: 200, msg: "Success"}

		Ob Error:
			status: boolean - set to false
			data: object - an object containing data on the error
	*/
	addSongs : function(tokens, userId, playListId, trackUris) {
		if(!tokens) throw new Error("Tokens required to remove songs");
		if(!tokens.access_token) throw new Error("Access token required to remove songs");
		if(!userId) throw new Error("User ID is required to remove songs");
		if(!playlistId) throw new Error("Playlist ID required to remove songs");
		if(!trackUris) throw new Error("Track URIs are required to remove songs");
	},
	_recurseAddSongs : function(tokens, userId, playListId, trackUris) {
		return new Promise(function(resolve, reject) {
			var postFixPath = "users/{user_id}/playlists/{playlist_id}/tracks"
				.replace("{user_id}", userId)
				.replace("{playlist_id}", playListId);

			var opts = getStubAPIRequest(tokens.access_token, postFixPath);
			opts.method = 'post';
			opts.headers["Content-Type"] = "application/json";

		});
	},


	/**
		Remove songs from the playlist

		Expects:
			tokens:Object - the tokens received during authorization
					tokens.access_token should be present
			userId:string - the user id (NOT Spotify URI)
			playlistId:string - the playlist id to remove the songs from (NOT Spotify URI)
			trackUris:array - an array of objects containing track URIs
				Format : {
					'trakcs' : [
						{'uri' : <spotify track URI>},
						{'uri' : <spotify track URI>}, ...
					]
				}
			callback - (optional) a callback on completion
				Parameters:
					success:boolean - success or fail
					data:object | string - result data

			On Success:
				Callback is called with success set to True.
				Data will be an object: { code: 200, msg: "success" }

			On Error:
				Callback is called with success set to False.
				Data will be the data returned by the connection, this may
				be a string or an object.
	**/
	removeSongs : function(tokens, userId, playlistId, trackUris, callback) {
		if(!tokens) throw new Error("Tokens required to remove songs");
		if(!tokens.access_token) throw new Error("Access token required to remove songs");
		if(!userId) throw new Error("User ID is required to remove songs");
		if(!playlistId) throw new Error("Playlist ID required to remove songs");
		if(!trackUris) throw new Error("Track URIs are required to remove songs");
		if(trackUris.length > 100) throw new Error("You can only remove 100 songs or less in one request");
		if(callback && typeof callback != 'function') throw new Error("Callback must be a function");

		var	path_postfix = "users/{uID}/playlists/{pID}/tracks"
							.replace("{uID}", userId)
							.replace("{pID}", playlistId);

		var opts = getStubAPIRequest(tokens.access_token, path_postfix);
		opts.method = "delete";
		opts.headers["Content-Type"] = 'application/json';
		opts.entity = trackUris;

		var client = rest.wrap(mime);
		client(opts).then(function(response) {
			if(response.status.code==200) {
				callback(true, {code:200, msg:"success"});
			}
		})
		.catch(function(response) {
			callback(false, response.entity);
		});
	},

	lookupPlaylistId : function(tokens, userId, playlistName) {
		return new Promise(function(resolve, reject) {

		});
	},
	createBroadSpotPlaylist : function(tokens, userId, playlistName) {
		return new Promise(function(resolve, reject) {
			// Create
		});
	},
	/**
		Get all the playlists on the host's account

		Returns:
			A promise

		On Success:
			Resolves to 2 parameters.
				status: boolean - set to true to signify success
				data: object - Holding the information
					{
						code: int - should be set to 200
						playLists: array - array of playlist objects
							{
								name: string - name of playlist
								id: string - id of the playlist
							}
					}
	*/
	getHostsPlaylists : function(tokens, userId) {
		if(!tokens) throw new Error("Tokens are required to retrieve playlists");
		if(!tokens.access_token) throw new Error("Access token is required to retrieve playlists");
		if(!userid) throw new Error("The host user id is required to retrieve playlists");

		return new Promise(function(resolve, reject) {
			var postFixPath = "users/{1}/playlists".replace("{1}", userId);
			var opts = getStubAPIRequest(tokens.access_token, postFixPath);
			
			resolve(this._recurseGetPlaylists(tokens, userId, opts.path));
		});
	},
	_recurseGetPlaylists : function(tokens, userId, url, curPlaylists) {
		if(!curPlaylists) curPlaylists = [];
		return new Promise(function(resolve, reject) {
			// Set up request options
			var opts = getStubAPIRequest(tokens.access_token, "");
			opts.path = url;
			opts.method = 'get';
			opts.headers["Accept"] = 'application/json';

			var client = rest.wrap(mime);
			winston.debug("spotify: get playlists: request:", opts);

			client(opts).then(function(response) {
				// Grab all the names and IDs on this page
				var data = response.entity;
				if(data.items.length > 0) {
					data.items.forEach(function(playlist) {
						var pl = {
							name : playlist.name,
							id : playlist.id
						};
						curPlaylists.push(pl);
						winston.debug("spotify: get playlists: added pId: ", playlist.id);
					});
				}
				// If there are more pages, recurse for more
				if(data.next) {
					winston.debug("spotify: get playlists: going to next page: ", data.next);
					resolve(_recurseGetPlaylists(tokens, userId, data.next, curPlaylists));
				}
				else {
					winston.debug("spotify: get playlists: finish");
					resolve(true, {code : 200, playLists : curPlaylists});
				}
			})
			.catch(function(response) {
				winston.error("spotify: get playlists: error(", response.status.code, "): ",response.entity);
				var err = new errors.FETCH_PLAYLISTS_FAILED();
				err.msg += response.entity;
				reject(false, err);
			});
		});
	},

	/**
		Get all tracks via a Promise

		Expects:
			tokens: object - fresh hosts session tokens
			userId: string -  the host's user ID
			playListId: string - the playlist ID

		Returns:
			A promise

		On Success:
			Promise resolves 2 paramteres
			Parameters:
				status: boolean: set to true
				data: array: an array of track objects
					{
						name: string - track title
						artist: string - artist name
						album: string - track album name
						uri: string - spotify uri for the track
					}
		On Error:
			Promise resolve 2 parameters
			Parameters:
				status: boolean: set to false
				data: an object of the error data
	*/
	getPlaylistTracks : function(tokens, userId, playListId) {
		if(!tokens) throw new Error("Tokens are required to retrieve playlist tracks");
		if(!tokens.access_token) throw new Error("Access token is required to retrieve playlist tracks");
		if(!userId) throw new Error("The host user id is required to retrieve playlist tracks");
		if(!playListId) throw new Error("The playlist id is required to retrieve the tracks");

		// Get the starting url
		var postFixPath = "users/{user_id}/playlists/{playlist_id}"
			.replace("{user_id}", userId)
			.replace("{playlist_id}", playListId);

		var stub = getStubAPIRequest(tokens.access_token, postFixPath);
		var url = stub.path;
		return new Promise(function(resolve, reject) {
			resolve(this._recurseGetPlaylistTracks(tokens, userId, playListId, url));
		});
	},
	_recurseGetPlaylistTracks : function(tokens, userId, playListId, url, tracksList) {
		if(!tracksList) tracksList = [];

		return new Promise(function(resolve, reject) {
			// Setup REST request options
			var opts = getStubAPIRequest(tokens.access_token, "");
			opts.path = url;
			opts.method = 'get';
			opts.headers["Accept"] = "application/json";
			opts.params = {
				fields : "tracks.items(track(name, artists(name), album(name),uri))"
			};

			winston.debug("_recurseGetPlaylistTracks: rest request opts: ", opts);
			var client = rest.wrap(mime);
			client(opts).then(function(response) {
				var results = response.entity;
				
				// Pull the track info and convert it into a simple object
				var receivedTracks = extractTracksFromGetPlayListTracks(results);
				receivedTracks.forEach(function(val) {
					tracksList.push(val);
				});

				// See if there are more tracks
				if(results.next) {
					winston.debug("_recurseGetPlaylistTracks: next page: ", results.next);
					resolve(this._recurseGetPlaylistTracks(tokens, userId, playListId, results.next, tracksList));
				}
				else {
					var out = {
						code : 200,
						data : tracksList
					};
					winston.debug("_recurseGetPlaylistTracks: finished, resolving: ", out);
					resolve(true, out);
				}

			})
			.catch(function(response) {
				winston.error("_recurseGetPlaylistTracks: error getting playlist tracks: ", response.entity);
				resolve(false, response.entity);
			});
		});

	},
	copyOverPlaylist : function(tokens, userId, targetListId, playlistId) {
		// Get Playlist Tracks
		winston.debug("copyOverPlaylist: getting target playlist tracks, id:", targetListId);
		this.getPlaylistTracks(tokens, userId, targetListId)
			.then(function(status, data) {
				var tracks = data;


			})
			.catch(function(status, err) {

			});
	},

	TokenExpiredError : "error: token_expired"
};

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
	path : "/authorize/?client_id={clientid}&response_type=code&redirect_uri={redirecturi}{state}{scope}{showdialog}"
};

/*
	Helper function for generating the request header
	for any API calls _AFTER_ authorization.

	Remember to set METHOD
*/
function getStubAPIRequest(access_token, path_postfix) {
	return {
		method : null,
		path : "https://" + api_url.domain + api_url.path,
		headers : {
			"Authorization" : "Bearer " + tokens.access_token
		}
	};
}

/*
	Helper function to parse the tracks out Spotify's
	JSOn structure and into individual track objects
*/
function extractTracksFromGetPlayListTracks(respData) {
	var out = [];
	respData.tracks.items.forEach(function(val) {
		var track = {
			name : val.track.name,
			album: val.track.album.name,
			artist: val.track.artists[0].name,
			uri: val.track.uri
		};
		out.push(track);
	});
	return out;
}

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
		for(var key in module.exports.SCOPES) {
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
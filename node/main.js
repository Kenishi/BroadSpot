/*
	Massive scoping problems inside spotify.js

	Many of the functions tend to make calls to other module functions to complete
	their actions.

	These functions are not visible from inside the Promise().

	Note: need to remove self. references in spotify module. They didn't solvve the scope
	issue.
*/
/*
	Left off at:

	Debug logs need to be added to confirm that the server-client connection is working

	Remove the test code in the host_control

	Add an emit.changeCode so host can get his party code

	Clean up logging code a little bit
*/

/*
	TODOs:
		* Refactor way errors are passed to rendered pages. Currently there is no
			enumeration of errors.
				Of Note: hostAuthResult and checkSid/verifySession
		* Refactor/Split out routes into their seperate file. Host is quite large,
			especially when factoring in the Socket.io commands.
		* Fix addSong in Session so it moves songs ahead in queue if already there.
		* Work out a method 

		* Set up production logging
		* Need to look into what happens if a song not available in a hosts region
			is added to the queue. Does an error occur on add?
		* BUG: Serch results don't pull all of the artists name from a search result
			it only pulls the first artist on the track.
			Need to modify the PARTY SEARCH endpoint.
			Need to modify "spotify.getPlaylistTracks"
			Need to modify the web frontend so it expects an array of artist names

		* Create session save on receiving SIGTERM (process.on('SIGTERM', func))
		* Create session restore on restart
		* Move doQueue into Session prototype
		* Move playlist operations into Session prototype
		* Move token based operations into Session prototype
		* Move the /party search functionallity into spotify.js
		* Refactor getPlaylists emit event => getHostsPlaylists in frontend and backend
		* Add a connected indicator on the navbar of the host control
*/

var fs = require('fs'),
	crypto = require('crypto'),
	os = require('os'),

	winston = require('winston'),
	express = require('express'),
	http = require('http'),
	bodyParser = require('body-parser'),
	rest = require('rest'),
	mime = require('rest/interceptor/mime'),
	cookieParser = require('cookie-parser'),
	socketCookieParser = require('socket.io-cookie'),
	cookieSession = require('cookie-sessions'),
	uuid = require('node-uuid'),

	spotify = require('./spotify'),
	spotify_keys = require('./spotify_keys'),
	errors = require('./public/js/errors');

winston.level = 'input';
winston.cli();

var PORT = process.env.PORT || 3000;
var HOSTNAME = os.hostname();

var app = express();
var server = http.createServer(app).listen(PORT);
var io = require('socket.io').listen(server);

var CLIENT_ID = spotify_keys.CLIENT_ID;
var CLIENT_SECRET = spotify_keys.CLIENT_SECRET;

var AUTH_REDIRECT_URL = "http://" + HOSTNAME + ":" + PORT + "/host/auth";
var MAX_RESULTS = 30;
var AUTH_STATE = uuid.v4().replace(/-/g,'');

var SESSION_QUEUING_TIMEOUT = 3600 * 1000; // Queuing is disabled after 1 hour of no host
var SESSION_DELETE_TIMEOUT = (3600 * 24) * 1000; // Session is removed after a day of no reconnect

var BROADSPOT_PLAYLIST_NAME = "My BroadSpot Playlist";

/* All current running sessions */
var Sessions = {
	sessions : [],

	createSession : function(sid) {
		var sess = null;
		if(sid) {
			if(this.getSession(sid)) {
				// Remove previous session
				var oldSess = this.getSession(sid);
				oldSess.destroySession();
				oldSess = null;
			}
			sess = new Session();
			sess.sid = sid;
		}
		else {
			sess = new Session();
		}
		return sess;
	},
	getSession : function(sess) {
		var out = null;
		this.sessions.every(function(val) {
			if(val.sid == sess.sid) {
				out = val;
				return false;
			}
			if(val.ip == sess.ip) {
				out = val;
				return false;
			}
			return true;
		});
		return out;
	},
	addSession : function(sess) {
		if(!sess) throw new Error("Session cannot be null or undefined");
		this.sessions.push(sess);
	},
	removeSession : function(sess) {
		if(!sess) throw new Error("Session cannot be null or undefined");
		this.sessions = this.sessions.filter(function(val, index, arr) {
			return val !== sess;
		});
	},
	findBySid : function(sid) {
		var sess = this.sessions.filter(function(ses) {
			return ses.sid == sid;
		});
		sess = sess.length > 0 ? sess[0] : null;
		return sess;
	},
	findByPartyCode : function(code) {
		var sess = this.sessions.filter(function(ele, index) {
			var result = ele.partyCode == code;
			return ele.partyCode == code;
		});

		sess = sess.length > 0 ? sess[0] : null;
		return sess;
	},
	findBySocket : function(socket) {
		var sess = this.sessions.filter(function(ses) {
			return ses.socket === socket;
		});
		sess = sess.length > 0 ? sess[0] : null;
		return sess;
	},
	destroySession : function(targetSess) {
		this.removeSession(targetSess);
		targetSess.destroySession();
	},
	debugPrintSessions : function() {
		winston.debug("---CURRENT SESSIONS (" + this.sessions.length + ")---");
		this.sessions.forEach(function(val) {
			winston.debug("---Session---");
			winston.debug("SID: " + val.sid);
			winston.debug("SIP: " + val.sessionIP);
			winston.debug("Party Code: " + val.partyCode);
			winston.debug("-------------");
		});
	}
};

/* Session Class */
function Session() {
	this.sid = null;
	this.createTime = Date.now();
	this.sessionIP = null; // IP of the host this session is associated with
	this.socket = null; // Socket to host

	this.userId = null; // Host Spotify User ID
	this.state = getState(); // State used during authentication
	this.tokens = null; // AccessToken and RefreshToken for this session
	this.playlistId = null; // The playlist id


	/* 
		Users that have queued tracks.
		{ 
			ip: string, - ip of the user
			lastQueueTime: int - last time user added a song
		}
	*/
	this.userList = []; // Users that have queued

	/*
		Array of objects representing tracks in playlist
		{
			ip: string - ip of the user who queued it
			trackUri: string - spotify URI of the track
			name: strin - track name
			artist: string - track artist name
			album: string - album name
		}
	*/
	this.playList = [];

	/*
		Array of objects of banned users
		{
			ip: string, - ip of banned user
			lastQueueTime: int - last time user added a song
		}
	*/
	this.banned = []; // Banned user array

	this.queueingEnabled = true; // Host can toggle this start/stop queing from users
	this.partyCode = null; // Party code public users use

	this.disableQueueTimer = null; // Timer ID for disabling queuing
	this.deleteSessionTimer = null; // Timer ID for deleting this session
}

Session.prototype.toString = function() {
	var out = "Sid: " + this.sid + "; CreateTime: " + this.createTime.toString() + "; SIP: " + this.sessionIP +
		"; PartyCode: " + this.partyCode;
	return out;
};

/* Is user in the banned list? */
Session.prototype.isBanned = function(ip) {
	return !this.banned.every(function(val) {
		return val.ip != ip;
	});
};

/*
	Add a user to ban list for the session
*/
Session.prototype.banUser = function(ip) {
	if(!ip) throw new Error("IP is required to ban user");

	var user;

	// Remove from user list
	this.userList = this.userList.filter(function(val) {
		if(val.ip == ip) {
			user = val;
			return false;
		}
		return true;
	});

	// Add to ban list
	if(user) {
		this.banned.push(user);
	}

	// Remove Songs from playlist
	this.removeSongsByIp(ip);
};

/*
	Remove a user from the ban list
*/
Session.prototype.unBanUser = function(ip) {
	if(!ip) throw new Error("IP is required to unban user");

	var user;

	this.banned = this.banned.filter(function(val) {
		if(val.ip == ip) {
			user = val;
			return false;
		}
		return true;
	});

	this.userList.push(user);
};

/*
	Add ip ('user') to the list of queueing members
	Return true if added, false if the user already exists
*/
Session.prototype.addUser = function(ip) {
	if(!ip) throw new Error("IP of user is required to add to the userlist");

	var exists = !this.userList.every(function(val) {
		return val.ip != ip;
	});

	if(!exists) {
		newUser = {
			ip : ip,
			lastQueueTime : 0
		};
		this.userList.push(newUser);
	}

	// Logic note: If the user didn't exist we added
	return !exists;
};

/**
	Find a user by their ip

	Expects:
		ip: string - the ip of the user

	Returns:
		the user object if found.
		null if the user is not found
*/
Session.prototype.findUserByIp = function(ip) {
	if(!ip) throw new Error("IP is required to find a user");

	var users = userList.filter(function(user) {
		return user.ip == ip;
	});
	return users.length > 0 ? users[0] : null;
};

/*
	Get the last time the ip queued a song.

	Return timestamp, null if the user doesn't exist
*/
Session.prototype.getQueueTime = function(ip) {
	if(!ip) throw new Error("IP is required to get queue time");

	var user = this.userList.filter(function(val) {
		return val.ip == ip;
	});

	return user.length > 0 ? user[0].lastQueueTime : null;
};

/*
	Update the queue time of the ip to now

	Returns the user if found with updated time, null if not found
*/
Session.prototype.updateQueueTime = function(ip) {
	if(!ip) throw new Error("IP is required to update queue time");

	var user = this.userList.filter(function(val) {
		return val.ip == ip;
	});

	if(user.length > 0) {
		user[0].lastQueueTime = Date.now();
		return user[0];
	}
	else {
		return null;
	}
};

Session.prototype.addTrack = function(ip, trackUri) {
	if(!ip) throw new Error("IP of user adding the track is required");
	if(!trackUri) throw new Error("Track URI is required to add to the playlist");

	this.refreshPlaylist().then(function(status, data) {
		this.addUser(ip);
		var queueTime = this.updateQueueTime(ip);
		
		spotify.getTrackInfo(trackUri).then(function(status, data) {
			var track = data.data;
			track.ip = ip;
			track.queueTime = queueTime;

			spotify.addSongs(this.tokens, this.userId, this.playListId, [trackUri])
				.then(function() {
					winston.debug("addTrack: track added success: ", trackUri, " by ", ip);
					this.playList.push(track);

					winston.debug("addTrack: updating view on playlist change");
					this.socket.emit("updatePlaylist", this.playList);
				})
				.catch(function(status, err) {
					winston.debug("addTrack: track failed to add: ", err);
				});
		})
		.catch(function(status, err) {
			winston.error("addTrack: failed to retrieve track info: ", err);
		});
	})
	.catch(function(status, err) {
		winston.error("addTrack: refresh playlist failed: ", err);
	});
};

/*
	Remove all songs added by IP

	ip: string - ip of the user
	callback: function - (optional) callback function on completion/fail
*/
Session.prototype.removeSongsByIp = function(ip, callback) {
	if(callback && typeof callback != 'function') throw new Error("Callback must be a function");

	var removeList = [];
	this.playList = this.playList.filter(function(val) {
		if(val.ip == ip) {
			removeList.push({uri : val.trackUri});
			return false;
		}
		return true;
	});

	spotify.removeSongs(this.tokens, this.userId, this.playlistId, removeList)
		.then(callback).catch(callback);
};

/*
	Generates a new party code but doesn't update
	it
*/
Session.prototype.newPartyCode = function() {
	var code = Math.round(Math.random()*100000);
	while(Sessions.findByPartyCode(code).length > 0) {
		code = Math.round(Math.random()*100000);
	}

	return code;
};

Session.prototype.getPlaylistId = function() {
	return this.playlistId;
};

Session.prototype.getUserId = function() {
	return this.userId;
};

Session.prototype.destroySession = function() {
	if(this.socket && this.socket.connected) {
		this.socket.disconnect();
	}

	this.socket = null;
	this.sid = null;
	this.tokens = null;
	this.partyCode = null;
};

Session.prototype.clearTimers = function() {
	if(this.queueTimer) {
		clearTimeout(this.queueTimer);
		this.queueTimer = null;
		winston.info("clearTimers: queue timer was cleared: sid: ", this.sid);
	}
	if(this.deleteTimer) {
		clearTimeout(this.deleteTimer);
		this.deleteTimer = null;
		winston.info("clearTimers: delete timerw as cleared: sid:", this.sid);
	}
};

/*
	Verify access_token has not expired and refresh if
	it has.

	On Success:
		Promise will resolve with 2 parameters.
			status : boolean set to True
			data : object - 
				{
					code : int = 200
					msg : string - message stating whether it was refreshed or not
				}
	On Error:
		Promise will resolve with 2 paramters.
			status : boolean set to False
			data : object - values may differ depending on where the error occured.
*/
Session.prototype.verifyFreshTokens = function() {
	if(!this.tokens) throw new Error("Session tokens are required");
	
	var sess = this;
	return new Promise(function(resolve, reject) {
		winston.debug("verifyFreshTokens: checking if tokens are expired");
		debugger;
		var hasExpired = sess.tokens.expires_at - Date.now();
		if(hasExpired) {
			winston.debug("verifyFreshTokens: tokens have expired, refresh");
			spotify.refreshTokens(sess.tokens.refresh_token, CLIENT_ID, CLIENT_SECRET)
			.then(function(ok, data) {
				winston.debug("verifyFreshTokens: tokens refreshed");
				resolve(true, { code: 200, msg: "tokens ok. refreshed."});
			})
			.catch(function(ok, data) {
				winston.debug("verifyFreshTokens: failed to refresh tokens");
				reject(ok, data);
			});
		}
		else {
			winston.debug("verifyFreshTokens: tokens ok, not refreshed");
			resolve(true, { code: 200, msg: "tokens ok. not refreshed."});
		}
	});
};

/**
	Refresh the server playlist against the spotify playlist

	Returns:
		A Promise that resolves to 2 parameters
	
		On Success:
			status: boolean - set to true
			data: object - result data
				{
					code : 200,
					addedTracks: boolean - True if tracks had to be synced and changed the server-side playlist
											False otherwise
				}
*/
Session.prototype.refreshPlaylist = function() {
	if(!this.tokens) throw new Error("Session tokens are not initilized");
	if(!this.userId) throw new Error("User ID is not initilized");
	if(!this.playlistId) throw new Error("Playlist ID is not set");

	return new Promise(function(resolve, reject) {
		var tracksAdded = false;

		winston.debug("refreshPlaylist: verifying tokens");
		this.verifyFreshTokens().then(function(status, result) {
			winston.debug("refreshPlaylist: tokens ok, getting playlist");
			spotify.getPlaylistTracks(this.tokens, this.userId, this.playListId)
				.then(function(status, data) {
					winston.debug("refreshPlaylist: processing spotify-side and session-side playlists");
					var refreshTracks = data.data;
					refreshTracks.forEach(function(rTrack) {
						// Add all refreshTracks to the filter array that aren't
						// in the session playlist
						if(!playlistContains(rTrack.uri)) {
							tracksAdded = true;
							rTrack.ip = null;
							sess.playList.push(rTrack);
						}
					});
					
					if(tracksAdded)
						winston.debug("refreshPlaylist: tracks were synced");
					else 
						winston.debug("refreshPlaylist: no tracks needed synced");

					var out = {
						code : 200,
						addedTracks: tracksAdded
					};
					resolve(true, out);
				})
				.catch(reject);
		});
	});
};

Session.prototype.playlistContains = function(trackUri) {
	/* 
		Explanation:
			Every track in the session playlist should NOT
			equal the supplied URI.
			If we reach the end of the playlist without finding
			a match, then every() will return 'true', flip to 'false'
			to signify "playlist does not contain the uri".
	*/
	return !this.playList.every(function(track) {
		return track.uri != trackUri;
	});
};

Session.prototype.doQueue = function(ip, trackId, lastQueue) {
	this.addTrack(ip, trackId);
};



// Set up the template engine
app.set('views', __dirname + "/views");
app.set('view engine', 'jade');

// Make static files available
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser({}));
app.use(express.static(__dirname + "/public"));



/*
	Index page
*/
app.get('/', function(req, res) {
	var isError = req.query.err == '1';
	res.render('index', { partyError : isError});
});

/*
	REST Endoing for searching for tracks on Spotify
	to queue up

	id - the party's code
*/
app.get('/party/:id', [getSession, checkBan, showParty]);

function getSession(req, res, next) {
	var id = req.params.id;
	Sessions.debugPrintSessions();
	winston.debug("looking for session: " + id);
	var session = Sessions.findByPartyCode(id);
	if(session) {
		req.session = session;
		winston.debug("session found: " + id);
		next();
	}
	else {
		winston.debug("session not found: " + id);
		res.redirect("/?err=1");
		res.end();
	}
}

function checkBan(req, res, next) {
	var session = req.session;
	var ip = req.ip;

	winston.debug("checking ban on: " + ip);
	if(session.isBanned(ip)) {
		winston.debug(ip + " BANNED");
		res.redirect('/berror');
		res.end();
	}
	else {
		winston.debug(ip + " OK");
		next();
	}
}

function showParty(req, res, next) {
	winston.debug("showing party");
	res.render('party');
}

/*
	Search request for a song

	Expects:
		query - name of song to look for

	On Success:
		[
			{
				name - name of the song
				album - name of the album
				img - url to cover art of the album
				artist - name of artist
				uri - spotify uri needed to queue song
			}, ... up to MAX_RESULTS results
		]
	On Error:
*/
app.post('/party', function(req, res) {
	var domain = "https://api.spotify.com";
	var endpoint = "/v1/search?q={0}&type=track&limit={1}";

	var query = null;
	try {
		query = req.body.params.query;
	} catch(e) {
		var out = new errors.INVALID_PARAMETERS();
		res.status(out.code).json(out);
		return;
	}

	if(typeof query == 'undefined' || query.length <= 0) {
		var out = new errors.INVALID_PARAMETERS();
		res.status(out.code).json(out);
		return;
	}

	query = encodeURIComponent(query);
	var path = endpoint.replace("{1}", MAX_RESULTS);
	path = path.replace("{0}", query);

	// Do REST search call
	var url = domain + path;
	var client = rest.wrap(mime);
	client(url).then(function(response) {
		// Response data is in response.entity
		var out = [];
		var tracks = response.entity.tracks.items;
		tracks.forEach(function(trackResult) {
			var item = {};
			item.title = trackResult.name;
			item.uri = trackResult.uri;
			item.album = trackResult.album.name;
			item.artist = trackResult.artists[0].name;
			item.queued = false;
			
			var imgLen = trackResult.album.images.length;
			if(imgLen >= 1) { // Grab the smallest image
				item.img = trackResult.album.images[imgLen-1].url;
			}

			out.push(item);
		});
		res.status(200).json(out);
	});
});


/*
	REST Endpoint for adding a track to a current
	party

	id - the party's code
	trackId - the track's url, this should be specified as a spotify
		protocol URI
*/
app.put('/queue/:id/:trackId', [getSession, checkBan, queueAction]);

function queueAction(req, res, next) {
	var ip = req.ip;
	var trackId = req.params.trackId;
	var session = req.session;

	session.addUser(ip);
	var lastQueue = session.getQueueTime(ip);
	session.doQueue(ip, req.params.trackId, lastQueue);
	session.updateQueueTime(ip);
	
	res.status(200).json({code:200});
	res.end();
}

/*
	The page banned users are redirected to if they 
	try to join a party or queue up a track
*/
app.get('/berror', function(req, res) {
	res.render('berror');
});

/* REST endpoint for the host's page. */
app.get('/host', [checkForErrors, checkSid, verifySession, showControl]);

// Verify host values before passing to hostControl
function checkForErrors(req, res, next) {
	var err = 0;
	winston.debug("/host: check for errors");

	try {
		err = res.query.err !== undefined ? res.query.err : err;
	} catch(e) {}

	if(err === 0) { // No error
		winston.debug("/host: no errors");
		next(); // Check sids next
	}
	else {
		// There is an error
		req.error = err;
		winston.debug("/host: error " + req.error);
		showLogin(req, res, next);
	}
}

// Check if a session id in cookies
function checkSid(req, res, next) {
	var sid;
	winston.debug("/host: checking sid");
	try {
		winston.debug("Cookies: ", req.cookies);
		sid = req.cookies.sid;
	} catch(e) { 
		winston.error("/host: error occured getting cookie: ", e);
		sid = undefined; 
	}

	if(typeof sid == 'undefined') {
		winston.debug("/host: no sid in cookie, go to login");
		showLogin(req, res, next);
	}
	else { // Sid exists, confirm session
		winston.debug("/host: found sid");
		req.sid = sid;
		next();
	}	
}

// Lookup session via SID and verify
function verifySession(req, res, next) {
	var sid = req.sid;
	var sess = Sessions.findBySid(sid);
	if(!sess) {
		// No sessions from sid, go to error
		winston.debug("/host: no sesssion obj found, goto login w/ error");
		req.error = 1;
		showLogin(req, res, next);
	}
	else {
		// Check tokens exist
		if(!sess.tokens) {
			// No token, go to error
			winston.debug("/host: no session tokens found, goto login w/ error");
			req.error = 1;
			showLogin(req, res, next);
		}
		else {
			winston.debug("/host: login complete go to host control");
			next();
		}
	}
}

function showControl(req, res, next) {
	res.render('host_control');
}

function showLogin(req, res, next) {
	if(req.error) {
		winston.debug("Showing host longin w/ error: " + req.error);
		res.render('host_login', {hostError: req.error});
	}
	else {
		winston.debug("Show host login no error");
		res.render('host_login', {hostError: 0});
	}
}

app.get('/testHostControl', [testHostControl]);

function testHostControl(req, res, next) {
	/* Create Session stuff here */

	res.render('host_control');
}


/*********************
	Authentication
**********************/
function hostAuthResult(req, res, next) {
	var state; 
	try { state = req.query.state; } catch(e) { state = undefined; }

	winston.debug("checking auth result");
	if(!state) {
		winston.debug("no state, move to login");
		showLogin(req, res, next); // No state
	}
	else if(state != AUTH_STATE) {
		req.error = 1;
		winston.debug("state wrong, move to login. error: " + req.error + "; state: " + state);
		showLogin(req, res, next); // State, but wrong show error
	}
	else {
		winston.debug("auth ok, continue logging in; state: " + state);
		hostAuthOk(req, res, next);
	}
}

function hostAuthOk(req, res, next) {
	var code = req.query.code;
	winston.debug("/host/auth: retrieving tokens");
	spotify.getTokens(code, AUTH_REDIRECT_URL, CLIENT_ID, CLIENT_SECRET, function(success, data) {
		if(success) {
			winston.debug("tokens got successfully");
			winston.debug(data);
			var tokens = {
				access_token : data.access_token,
				refresh_token : data.refresh_token,
				expires_in : data.expires_in,
				expires_at : data.expires_at
			};
			var ses = createSession(req, res, tokens);
			Sessions.addSession(ses);

			res.redirect('/host');
		}
		else {
			winston.error("failed to get tokens reason:", data);
			req.error = 1; // Error fetching tokens
			showLogin(req, res, next);
		}
	});
}

// Called by hostAuthOk to build the session
function createSession(req, res, tokens) {
	var sid = uuid.v4();
	res.cookie("sid", sid);
	winston.debug("sid cookie set:" + sid);

	var ip = req.ip;

	var ses = Sessions.createSession(sid);
	ses.ip = ip;

	spotify.queryUserInfo(tokens, function(ok, data) {
		if(ok) {
			ses.userId = data.id;
			winston.debug("user id set: " + ses.userId);
		}
		else {
			winston.error("Error getting user info: " + data);
		}
	});
	ses.tokens = tokens;
	winston.debug("createSession success: " + ses.toString());
	return ses;
}

app.get('/host/auth', [hostAuthResult]);

app.post('/host/auth', function(req, res) {
	var opts = {
		state : AUTH_STATE,
		scopes : [
			spotify.SCOPES.PLAYLIST_READ_PRIVATE,
			spotify.SCOPES.PLAYLIST_MODIFY_PUBLIC,
			spotify.SCOPES.PLAYLIST_MODIFY_PRIVATE
		],
		show_dialog: true
	};

	var url = spotify.authorizeURL(CLIENT_ID, AUTH_REDIRECT_URL, opts);
	var data = { url : url };
	res.status(200).json(data);
});

/*
	Host Socket.io setup

	Expects:
		sid - session id created at authentication in cookies

	Note: If the IP of host does not match the one in the session
		the SID points too, the connection will abort.
*/
io.use(socketCookieParser);
io.use(function(socket, next) {	
	winston.info("socketAuth: socket connected: ", socket.request.connection.remoteAddress);
	var sid;
	sid = socket.request.headers.cookie.sid;
	winston.debug("socketAuth: socket sid: ", sid);
	
	var sess = Sessions.findBySid(sid);
	if(sess) {
		var ip = socket.request.connection.remoteAddress;
		if(sess.ip != ip) {
			winston.error("socketAuth: Session ip and connecting ip do not match: ", ip);
			socket.disconnect();
			return;
		}
		winston.info("socketAuth: host authenticated: ", ip);
		
		// Remove any set timers
		var queueTimer = sess.queueTimer,
			deleteTimer = sess.deleteTimer;
		if(queueTimer) {
			clearTimeout(queueTimer);
		}
		if(deleteTimer) {
			clearTimeout(deleteTimer);
		}
		queueTimer = null;
		deleteTimer = null;

		/*** Set up session ***/
		sess.socket = socket;

		// Look for playlist and create if needed
		initSessionPlaylistOnSpotify(sess)
			.then(function(ok, data) {
				var playlistId = data.id;
				if(playlistId) {
					sess.playlistId = playlistId;
					winston.debug("socketAuth: got playlist id: ", playListId);
				}
				else {
					winston.error("socketAuth: Unexpected return in init playlist. playlistId: ", playlistId);
					socket.disconnect();
					Sessions.destroySession(sess);
				}
			})
			.catch(function(ok, data) {
				winston.error("socketAuth: Error init host playlist: ", data);
				socket.disconnect();
				Sessions.destroySession(sess);
			});
		
		next();
	}
	else {
		socket.disconnect();
		winston.debug("socketAuth: Session id does not exist");
	}
});

/*
	Host Socket events
*/
io.on('connection', function(socket) {
	
	// Update party code and playlist
	var sess = Sessions.findBySocket(socket);
	if(sess) {
		if(sess.partyCode) {
			socket.emit('updateCode', { partyCode : sess.partyCode });
			socket.emit('updatePlaylist', sess.playList);
		}
	}
	else {
		winston.error("onConnection: session not found by socket");
		socket.disconnect();
	}

	/******************
		Event Handlers
	*******************/

	socket.on('ban', function(data) {
		winston.debug("ban: " + data.ip);
		var sess = Sessions.findBySocket(socket);
		if(sess) {
			var ip = data.ip;

			sess.banUser(ip);
			socket.emit('updateBanList', this.banned);
		}
	});

	socket.on('unban', function(data) {
		winston.debug("unban: " + data.ip);
		var sess = Sessions.findBySocket(socket);
		if(sess) {
			var ip = data.ip;

			sess.unBanUser(ip);
			socket.emit('updateBanList', this.banned);
		}
	});

	socket.on('getBanList', function(data) {
		winston.debug("request ban list");
		var sess = Sessions.findBySocket(socket);

		if(sess) {
			socket.emit('updateBanList', this.banned);
		}
	});

	socket.on('changeCode', function(data) {
		winston.debug("request code change");
		var sess = Sessions.findBySocket(socket);

		if(sess) {
			var code = sess.newPartyCode();
			sess.partyCode = code;
			winston.debug("new code: " + code);

			var out = { partyCode : code };
			socket.emit('updateCode', out);
		}
	});

	socket.on('removeSong', function(data) {
		var sess = Sessions.findBySocket(socket);
		var trackId = data.trackId;
		winston.debug("remove song: " + trackId);

		if(sess) {
			sess.removeSong(trackId);
			socket.emit('updatePlaylist', sess.playList);
		}
	});

	/*
		Get the user's playlists

		Returns:
			[
				{
					name: string - playlist name,
					id: string - playlist id
				}
			]
	*/
	socket.on('getPlaylists', function(data) {
		var sess = Sessions.findBySocket(socket);

		if(sess) { 
			if(!sess.tokens) throw new Error("No tokens, cannot get playlists");

			// Request playlists of user
			sess.verifyFreshTokens()
				.then(function() {
					spotify.getHostsPlaylists(sess.tokens, CLIENT_ID, CLIENT_SECRET)
						.then(function(ok, data) {
							if(ok) {
								var playlists = data.playlists;
								var out = {
									code : 200,
									playlists : playlists
								};

								winston.debug("getPlaylists: sending: ", out);
								socket.emit('updateLists', out);
							}
							else {
								winston.error("getPlaylists: getHostsPlaylists resolved but status is false: ", data);
							}

						})
						.catch(function(status, data) {
							winston.error("getPlaylists: Error in request: ", data);
						});
				})
				.catch(function(status, data) {
					winston.error("getPlaylists: Error refreshing token: ", data);
				});
		}
		else {
			/* error */
		}
	});

	socket.on('addPlaylist', function(data) {
		var sess = Sessions.findBySocket(socket);
		if(!sess) { /* error */ }
		
		var targetListId = data.playlistId; 
		winston.debug("addPlaylist: copying playlist: ", targetListId);

		// Check tokens are fresh
		sess.verifyFreshTokens()
			.then(function(ok, data) {
				if(ok) {
					// Copy over playlist
					spotify.copyOverPlaylist(tokens, userId, targetListId, playlistId)
						.then(function(status, data) {
							if(status) {
								sess.playList = data.playlist;
								var out = {
									code  : 200,
									playlist : sess.playList
								};
								
								winston.debug("addPlaylist: sending: ", out);
								socket.emit('updatePlaylist', out);
							}
							else {
								winston.error("addPlaylist: copyOverPlaylist resolved but status is false: ", data);
							}

						})
						.catch(function(status, data) {
							winston.error("addPlaylist: Error copying playlist over: ", data);
							// Emit error about copying
						});
				}
				else {
					winston.error("addPlaylist: Error refreshing token: ", data);
				}
		});
		// Loop adding to current party list
		// Emit updatePlaylist w/ new list
		socket.emit('updatePlaylist', JSON.stringify(out));
	});

	socket.on('updatePowerState', function(data) {
		var sess = Sessions.findBySocket(socket);
		if(!sess) { 
			winston.error("updatePowerState: Error finding session. socket:", socket);
			return;
		}

		var queueEnabled = data.queueEnabled;
		winston.debug("updatePowerState: Queueing:", sess.queueEnabled, "=>", queueEnabled);

		sess.queueEnabled = queueEnabled;
		var out = {
			code : 200,
			powered : sess.queueEnabled
		};

		winston.debug("updatePowerState: sending: ", out);
		socket.emit('updatePowerState', out);
	});

	socket.on('disconnect', function(data) {
		var sess = Sessions.findBySocket(socket);
		if(!sess) { return; }

		winston.debug("disconnect: host disconnected: ", sess.toString());
		// Set timeout for turning off queuing on session
		sess.disableQueueTimer = setTimeout(disableQueueing, SESSION_QUEUING_TIMEOUT);
		// Set timeout for deleting sessions
		sess.deleteSessionTimer = setTimeout(deleteSession, SESSION_DELETE_TIMEOUT);
	});
});

/*
	Make calls to Spotify to confirm the BroadSpot playlist exists.
	If it does, do nothing.
	If not, create the playlist.

	Access Tokens will be refrehed if they have expired.

	Parameters:
		sess: object - the current session
	
	Returns a Promise

	On Success:
		Resolves promise with 2 paramters.
			status : boolean set to true
			playListId : string - the playlist id on sotify
	On Error:
		Resolves promise with 2 paramters.
			status : boolean set to false
			data : object - contains error data.
*/
function initSessionPlaylistOnSpotify(sess) {
	if(!sess) throw new Error("Session is required");
	if(!sess.tokens) throw new Error("Session tokens are required");
	if(!sess.userId) throw new Error("User id is required");

	return new Promise(function(resolve, reject) {
		winston.debug("initSessionPl: verify fresh tokens");
		sess.verifyFreshTokens()
			.then(function(ok, data) {
				if(ok) { 
					winston.debug("initSessionPl: tokens are fresh");
					winston.debug("initSessionPl: lookup broadspot playlist");
					spotify.lookupPlaylistId(sess.tokens, sess.userId, BROADSPOT_PLAYLIST_NAME)
					.then(function(playlistId) {
						if(playlistId) { // Return the playlistId
							winston.debug("initSessionPl: broadspot playlist found, returning id: ", playListId);
							var out = {
								code: 200,
								id : playlistId
							};
							resolve(true, out);
						}
						else { // Playlist doesn't exist so create it
							winston.debug("initSessionPl: broadspot playlist not found, creating");
							resolve(spotify.createPlaylist(sess.tokens, sess.userId, BROADSPOT_PLAYLIST_NAME));
						}
					})
					.catch(function(status, data) {
						reject(status, data);
					});
				}
			})
			.catch(function(status, data) { // Verifying/Refreshing tokens failed
				reject(status, data);
			});
	});
}

function getState() {
	var combo = (Math.floor(1 + Math.random() * 0x100000)) + new Date();
	var hasher = crypto.createHash('sha1');
	hasher.update(combo);
	var sid = hasher.digest('hex');
	return sid;	
}

function disableQueueing(sess) {
	sess.queueingEnabled = false;
}

function deleteSession(sess) {
	Sessions.destroySession(sess);
}

winston.info("ready: server listening at: " + HOSTNAME + ":" + PORT);
/*
	Left off at:
	Getting the socket events working. Many events needs to have a "findBySocket"
	added to get the session to be able to do anything.

	Debug logs need to be added to confirm that the server-client connection is working

	Remove the test session from bottom.

	Remove the test code in the host_control

	Add an emit.changeCode so host can get his party code

	Clean up logging code a little bit

	FIX the redirect after auth finishes, it gets stuck on the page
*/

/*
	TODOs:
		* Refactor way errors are passed to rendered pages. Currently there is no
			enumeration of errors.
				Of Note: hostAuthResult and checkSid/verifySession
		* Refactor/Split out routes into their seperate file. Host is quite large,
			especially when factoring in the Socket.io commands.

		* Set up production logging
		* Create session save on receiving SIGTERM (process.on('SIGTERM', func))
		* Create session restore on restart
*/

var fs = require('fs'),
	crypto = require('crypto'),
	os = require('os'),

	winston = require('winston'),
	express = require('express'),
	bodyParser = require('body-parser'),
	rest = require('rest'),
	mime = require('rest/interceptor/mime'),
	cookieParser = require('cookie-parser'),
	cookieSession = require('cookie-sessions'),
	uuid = require('node-uuid'),
	spotify = require('./spotify'),
	spotify_keys = require('./spotify_keys');

winston.level = 'input';
winston.cli();
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);

var CLIENT_ID = spotify_keys.CLIENT_ID;
var CLIENT_SECRET = spotify_keys.CLIENT_SECRET;

var PORT = process.env.PORT || 3000;
var HOSTNAME = os.hostname();
var AUTH_REDIRECT_URL = "http://" + HOSTNAME + ":" + PORT + "/host/auth";
var MAX_RESULTS = 30;
var AUTH_STATE = uuid.v4().replace(/-/g,'');

var SESSION_QUEUING_TIMEOUT = 3600 * 1000; // Queuing is disabled after 1 hour of no host
var SESSION_DELETE_TIMEOUT = (3600 * 24) * 1000; // Session is removed after a day of no reconnect

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
		var out = undefined;
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

	this.list = []; // Playlist
	this.banned = []; // Banned user array

	this.queueingEnabled = true; // Host can toggle this start/stop queing from users
	this.partyCode = 12345; // Party code public users use

	this.disableQueueTimer = null; // Timer ID for disabling queuing
	this.deleteSessionTimer = null; // Timer ID for deleting this session
};

Session.prototype.toString = function() {
	var out = "Sid: " + this.sid + "; CreateTime: " + this.createTime.toString() + "; SIP: " + this.sessionIP +
		"; PartyCode: " + this.partyCode;
	return out;
}

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
	var user;

	// Remove from user list
	this.list = this.list.filter(function(val) {
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
};

/*
	Remove a user from the ban list
*/
Session.prototype.unBanUser = function(ip) {
	var user;

	this.banned = this.banned.filter(function(val) {
		if(val.ip == ip) {
			user = val;
			return false;
		}
		return true;
	});

	this.list.push(user);
};

/*
	Add ip ('user') to the list of queueing members
	Return true if added, false if the user already exists
*/
Session.prototype.addUser = function(ip) {
	var exists = !this.list.every(function(val) {
		return val.ip != ip;
	})

	if(!exists) {
		newUser = {
			ip : ip,
			lastQueueTime : 0
		};
		this.list.push(newUser);
	}

	// Logic note: If the user didn't exist we added
	return !exists;
};

/*
	Get the last time the ip queued a song.

	Return timestamp, null if the user doesn't exist
*/
Session.prototype.getQueueTime = function(ip) {
	for(var i=0; i < this.list.length; i++) {
		var user = this.list[i];
		if(user.ip == ip) {
			return user.lastQueueTime;
		}
	}
	return null;
};

/*
	Update the queue time of the ip to now
*/
Session.prototype.updateQueueTime = function(ip) {
	for(var i=0; i < this.list.length; i++) {
		var user = this.list[i];
		if(user.ip == ip) {
			user.lastQueueTime = new Date();
			return user;
		}
	}
	return null;
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

Session.prototype.getPlaylist = function() {
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
		// LOG CLEARED QUEUE TIMER (info)
	}
	if(this.deleteTimer) {
		clearTimeout(this.deleteTimer);
		this.deleteTimer = null;
		// LOG CLEARED DELETE TIMER (info)
	}
}



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
		var out = errors.INVALID_PARAMETERS;
		res.status(out.code).json(out);
		return;
	}

	if(typeof query == 'undefined' || query.length <= 0) {
		var out = errors.INVALID_PARAMETERS;
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
	doQueue(req.params.id, req.params.trackId, lastQueue);
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
		err = res.query.err != undefined ? res.query.err : err;
	} catch(e) {}

	if(err == 0) { // No error
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
		winston.log("debug", "Cookies: ", req.cookies);
		sid = req.cookies.sid;
	} catch(e) { sid = undefined }

	if(typeof sid == 'undefined') {
		winston.debug("/host: no sid in cookie, go to login");
		showLogin(req, res, next);
	}
	else { // Sid exists, confirm session
		winston.debug("/host: found sid")
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
	winston.debug("getTokens: code=" + code);
	spotify.getTokens(code, AUTH_REDIRECT_URL, CLIENT_ID, CLIENT_SECRET, function(success, data) {
		if(success) {
			winston.debug("tokens got successfully");
			winston.debug(data);
			var tokens = {
				access_token : data.access_token,
				refresh_token : data.refresh_token,
				expires_in : data.expires_in,
				expires_at : data.expires_at
			}
			winston.log('debug', "tokens: %j", tokens);
			var ses = createSession(req, res, tokens);
			Sessions.addSession(ses);

			res.redirect(200, '/host');
		}
		else {
			winston.debug("failed to get tokens");
			winston.debug(data);
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
io.use(function(socket, next) {	
	var sid = socket.request;
	
	var sess = Sessions.findBySid(sid);
	if(sess) {
		var ip = socket.request.connection.remoteAddress;
		if(sess.ip != ip) throw new Error("Session ip and connecting ip do not match");
		console.log("Host Authenticated");
		next();
	}
	else {
		next(new Error("Session does not exist"));
	}
});

/*
	Host Socket events
*/
io.on('connection', function(socket, handshakeData) {
	
	/********************
		Connection Setup 
	*********************/
	// Look for prior session using sid
	var sid = handshakeData.sid;
	var sess = null;
	if(sid) {
		sess = Sessions.findBySid(sid);
	}
	else {
		// No SID, so disconnect and abort
		socket.disconnect();
		return;
	}

	if(sess) {
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
	} 
	else {
		// No session, so discconect and about
		socket.disconnect();
		return;
	}

	/******************
		Event Handlers
	*******************/

	socket.on('ban', function(data) {
		// TODO: Add findSession by socket
		winston.debug("ban: " + data.ip);
		var sess = Sessions.findBySocket(socket);
		if(sess) {
			var ip = data.ip;

			session.banUser(ip);
			socket.emit('updatePlaylist', JSON.stringify(list))
		}
	});

	socket.on('unban', function(data) {
		// TODO: Add findSession by socket
		var ip = data.ip;

		session.unBanUser(ip);
	});

	socket.on('getBanList', function(data) {
		// TODO: Add findSession by socket
		var list = [];
		for(var i=0; i < session.banned.length; i++) {
			if(session.banned[i] != undefined) {
				list.push(session.banned[i].ip);
			}
		}
		socket.emit('updateBanList', JSON.stringify(list));
	});

	socket.on('changeCode', function(data) {
		// TODO: Add findSession by socket
		var code = session.newPartyCode();
		session.partyCode = code;

		var out = { partyCode : code };
		socket.emit('updateCode', JSON.stringify(out));
	});

	socket.on('removeSong', function(data) {
		// TODO: Add findSession by sockets
		var trackId = data.trackId;

		// Oo remove
	});
	socket.on('getPlaylists', function(data) {
		var sess = Sessions.findBySocket(socket);
		if(!sess) { /* error */}

		// Request playlists of use
		// Parse playlist
		// Emit list names
		socket.emit('updateLists', JSON.stringify(out));
	});
	socket.on('addPlaylist', function(data) {
		var sess = Sessions.findBySocket(socket);
		if(!sess) { /* error */ }
		var listId = data.playlistId;

		// Fetch play list
		// Loop adding to current party list
		// Emit updatePlaylist w/ new list
		socket.emit('updatePlaylist', JSON.stringify(out));
	});

	socket.on('updatePowerState', function(data) {
		var sess = Sessions.findBySocket(socket);
		if(!sess) { /* error */ }
		var queueEnabled = data.queueEnabled;

		sess.queueEnabled = queueEnabled;
		var data = {
			powered : sess.queueEnabled
		};

		socket.emit('updatePowerState', data);
	});

	socket.on('disconnect', function(data) {
		var sess = Sessions.findBySocket(socket);
		if(!sess) { return; }

		// Set timeout for turning off queuing on session
		sess.disableQueueTimer = setTimeout(disableQueueing, SESSION_QUEUING_TIMEOUT);
		// Set timeout for deleting sessions
		sess.deleteSessionTimer = setTimeout(deleteSession, SESSION_DELETE_TIMEOUT);
	});
});

function doQueue(id, trackId, lastQueue) {
	console.log(id + ":" + trackId + ":: Added to queue");
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

errors = {
	INVALID_PARAMETERS : { code : 400, msg : "Invalid paramters supplied" }
}

var sess = Sessions.createSession();
sess.sid = "09876";
sess.partyCode = "12345";
Sessions.addSession(sess);

app.listen(PORT);
winston.info("server listening at: " + HOSTNAME + ":" + PORT);
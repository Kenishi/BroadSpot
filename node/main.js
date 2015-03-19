/*
	TODOs:
		* Refactor way errors are passed to rendered pages. Currently there is no
			enumeration of errors.
				Of Note: hostAuthResult and checkSid/verifySession
		* Refactor/Split out routes into their seperate file. Host is quite large,
			especially when factoring in the Socket.io commands.

		* Set up production logging
*/

var fs = require('fs'),
	crypto = require('crypto'),

	winston = require('winston'),
	express = require('express'),
	bodyParser = require('body-parser'),
	rest = require('rest'),
	mime = require('rest/interceptor/mime'),
	cookieParser = require('cookie-parser');
	cookieSession = require('cookie-sessions');
	spotify = require('./spotify'),
	spotify_keys = require('./spotify_keys');

winston.level = 'input';
winston.cli();
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);

var CLIENT_ID = spotify_keys.CLIENT_ID;
var CLIENT_SECRET = spotify_keys.CLIENT_SECRET;

var HOSTNAME = "localhost";
var AUTH_REDIRECT_URL = "http://" + HOSTNAME + "/host/auth";
var MAX_RESULTS = 30;

/* All current running sessions */
var Sessions = {
	sessions : [],

	createSession : function(sid) {
		var sess = null;
		if(sid) {
			if(getSession(sid)) {
				// Remove previous session
				var oldSess = getSession(sid);
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
	findByPartyCode : function(id) {
		var sess = this.sessions.filter(function(ses) {
			return ses.partyCode == id;
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

	this.queingEnabled = true; // Host can toggle this start/stop queing from users
	this.partyCode = 12345; // Party code public users use
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
	if(this.socket.connected) {
		this.socket.disconnect('destroying');
	}

	this.socket = null;
	this.sid = null;
	this.tokens = null;
	this.partyCode = null;
}



// Set up the template engine
app.set('views', __dirname + "/views");
app.set('view engine', 'jade');

// Make static files available
app.use(express.static(__dirname + "/public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser({}));

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

	winston.debug("looking for session: " + id);
	var session = Sessions.findByPartyCode(id);
	if(session && session.length > 0) {
		req.session = session[0];
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
		var items = response.entity.tracks.items;
		items.foreach(function(item) {
			item.title = item.name;
			item.uri = item.uri;
			item.album = item.album.name;
			item.artist = item.artists[0].name;
			item.queued = false;
			
			var imgLen = items.album.images.length;
			if(imgLen >= 1) { // Grab the smallest image
				item.img = items.album.images[imgLen-1].url;
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
	try {
		err = res.query.err != undefined ? res.query.err : err;
	} catch(e) {}

	if(err == 0) { // No error
		next(); // Check sids next
	}
	else {
		// There is an error
		req.error = err;
		showLogin(req, res, next);
	}
}

// Check if a session id in cookies
function checkSid(req, res, next) {
	var sid;
	try {
		sid = req.cookie.sid;
	} catch(e) { sid = undefined }

	if(typeof sid == 'undefined') {
		req.error = 1;
		showLogin(req, res, next);
	}
	else { // Sid exists, confirm session
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
		req.error = 1;
		showLogin(req, res, next);
	}
	else {
		// Check tokens exist
		if(!sess[0].tokens) {
			// No token, go to error
			req.error = 1;
			showLogin(req, res, next);
		}
		else {
			next();
		}
	}
}

function showControl(req, res, next) {
	res.render('host_control');
}

function showLogin(req, res, next) {
	if(req.error) {
		res.render('host_login', {hostError: req.error});
	}
	else {
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
	var code = req.query.code;
	var state; 
	try { state = req.query.state; } catch(e) { state = undefined; }

	if(!state || state != session.state) {
		req.error = 1;
		showLogin(req, res, next); // No state response, show error
	}
	else {
		hostAuthOk(req, res, next);
	}
}

function hostAuthOk(req, res, next) {
	spotify.getTokens(code, AUTH_REDIRECT_URL, CLIENT_ID, CLIENT_SECRET, function(success, data) {
		if(success) {
			var tokens = {
				access_token : data.access_token,
				refresh_token : data.refresh_token,
				expires_in : expires_in,
				expires_at : data.expires_at
			}
			var ses = createSession(req, res, tokens);
			Sessions.addSession(ses);

			res.redirect(200, '/host');
		}
		else {
			req.error = 1; // Error fetching tokens
			showLogin(req, res, next);
		}
	});
}

// Called by hostAuthOk to build the session
function createSession(req, res, tokens) {
	var sid = Math.floor(1 + Math.random() * 0x1000000);
	res.cookie("sid", sid.toString());

	var ip = req.ip;

	var ses = Sessions.createSession(sid);
	ses.ip = ip;

	spotify.queryUserInfo(tokens, function(ok, data) {
		if(ok) {
			var id = data.id;
			ses.userId = id;
		}
		else {
			console.log("Error getting user info: " + data);
		}
	});

	return ses;
}

app.get('/host/auth', [hostAuthResult]);

app.post('/host/auth', function(req, res) {
	var opts = {
		state : session.state,
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
	sess = sess ? ses[0] : null;
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
io.on('connection', function(socket) {
	socket.on('ban', function(data) {
		// TODO: Add findSession by socket
		var ip = data.ip;

		session.banUser(ip);
		// socket.emit('updatePlaylist', JSON.stringify(list))
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
		// Clear session
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

errors = {
	INVALID_PARAMETERS : { code : 400, msg : "Invalid paramters supplied" }
}

var sess = Sessions.createSession();
Sessions.addSession(sess);
sess.sid = "09876";
sess.partyCode = "12345";

var port = process.env.PORT || 3000;
app.listen(port);
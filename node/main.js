var fs = require('fs'),
	crypto = require('crypto'),

	express = require('express'),
	bodyParser = require('body-parser'),
	rest = require('rest'),
	mime = require('rest/interceptor/mime'),
	cookieParser = require('cookie-parser');
	//cookieSession = require('cookie-sessions');
	//spotify = require('./spotify');

var app = express();
var server = require('http').createServer(app);
var io = require('io')(server);
var PORT = proc.env.PORT || 3000;

var CLIENT_ID = "thisismyclientidhere";
var CLIENT_SECRET = "DHSH796hsF!f49hg9439";

var HOSTNAME = "localhost";
var REDIRECT_URL = "http://" + HOSTNAME + "/host/auth";
var MAX_RESULTS = 30;

var session = {
	getState : function() {
		var combo = "GE(&gh3ldf" + new Date();
		var hasher = crypto.createHash('sha1');
		hasher.update(combo);
		var sid = hasher.digest('hex');
		return sid;	
	},
	/* Is user in the banned list? */
	isBanned : function(ip) {
		for(var i=0; i < this.banned.length; i++) {
			var user = this.banned[i];
			if(user.ip == ip) return true;
		}
		return false;
	},
	/*
		Add a user to ban list for the session
	*/
	banUser : function(ip) {
		var user;
		var deleted = false;
		for(var i=0; i < this.list.length; i++) {
			user = this.list[i];
			if(user.ip == ip) {
				delete this.list[i];
				deleted = true;
				break;
			}
		}
		for(var i=0; i < this.banned.length && deleted; i++) {
			if(this.banned[i] == undefined) {
				this.banned[i] = user;
				user = null;
			}
		}
		if(user != null) this.banned.push(user);
	},
	/*
		Remove a user from the ban list
	*/
	unBanUser : function(ip) {
		for(var i=0; i < this.banned.length; i++) {
			var user = this.banned[i];
			if(user.ip == ip) {
				delete this.banned[i];
				break;
			}
		}
	},
	/*
		Add ip ('user') to the list of queueing members
		Return true if added, false if the user already exists
	*/
	addUser : function(ip) {
		var freeSlot = -1;
		for(var i=0; i < this.list.length; i++) {
			var user = this.list[i];
			if(user == undefined) {
				freeSlot = i;
				continue;
			}
			if(user.ip == ip) return false;
		}
		// Create user to add to list
		newUser = {
			ip : ip,
			lastQueueTime : 0
		};
		// Reuse any prior deleted spots
		if(freeSlot < 0) {
			this.list.push(newUser);
		}
		else {
			this.list[i] = newUser;
		}
		return true;
	},
	/*
		Get the last time the ip queued a song.

		Return timestamp, null if the user doesn't exist
	*/
	getQueueTime : function(ip) {
		for(var i=0; i < this.list.length; i++) {
			var user = this.list[i];
			if(user.ip == ip) {
				return user.lastQueueTime;
			}
		}
		return null;
	},
	/*
		Update the queue time of the ip to now
	*/
	updateQueueTime : function(ip) {
		for(var i=0; i < this.list.length; i++) {
			var user = this.list[i];
			if(user.ip == ip) {
				user.lastQueueTime = new Date();
				return user;
			}
		}
		return null;
	},
	/*
		Generates a new party code but doesn't update
		it
	*/
	newPartyCode : function() {
		var code = Math.round(Math.random()*100000);
		while(code == session.partyCode) {
			code = Math.round(Math.random()*100000);
		}

		return Math.round(Math.random()*100000);
	},
	getPlaylist : function() {
		return this.playlistId;
	},
	getUserId : function() {
		return this.userId;
	},
	state : getState(),
	playlistId : null,
	userId : null,
	list : [],
	banned : [],
	tokens : null,
	//partyCode : null
	partyCode : 12345
};

// Set up the template engine
app.set('views', __dirname + "/views");
app.set('view engine', 'jade');

// Make static files available
app.use(express.static(__dirname + "/public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
//app.use(cookieParser());

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
app.get('/party/:id', function(req, res) {
	var ip = req.ip;
	if(session.isBanned(ip)) {
		res.redirect('/berror');
	}

	// Show party page
	var id = req.params.id;
	if(id != session.partyCode) {
		res.redirect("/?err=1");
	} 
	else {
		res.render('party');
	}
});

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
		res.status(out.code).send(JSON.stringify(out));
		return;
	}

	if(typeof query == undefined || query.length <= 0) {
		var out = errors.INVALID_PARAMETERS;
		res.status(out.code).send(JSON.stringify(out));
		return;
	}

	query = encodeURIComponent(query);
	var path = endpoint.replace("{1}", MAX_RESULTS);
	path = path.replace("{0}", query);

	
	var url = domain + path;
	var client = rest.wrap(mime);
	client(url).then(function(response) {
		// Response data is in response.entity
		var out = [];
		var items = response.entity.tracks.items;
		for(var i=0; i < items.length; i++) {
			var item = {};
			item.title = items[i].name;
			item.uri = items[i].uri;
			item.album = items[i].album.name;
			item.artist = items[i].artists[0].name;
			item.queued = false;
			
			var imgLen = items[i].album.images.length;
			if(imgLen >= 1) {
				item.img = items[i].album.images[imgLen-1].url;
			}

			out.push(item);
		}
		res.status(200).send(JSON.stringify(out));
	});
});


/*
	REST Endpoint for adding a track to a current
	party

	id - the party's code
	trackId - the track's url, this should be specified as a spotify
		protocol URI
*/
app.put('/queue/:id/:trackId', function(req, res) {
	var id = req.params.id;
	if(session.partyCode != id) {
		res.redirect(out.code, '/?err=1');
	}
	var ip = req.ip;

	// Redirect banned users to a fake error page
	if(session.isBanned(ip)) {
		res.redirect('/berror');
	}

	session.addUser(ip);
	var lastQueue = session.getQueueTime(ip);
	doQueue(req.params.id, req.params.trackId, lastQueue);
	session.updateQueueTime(ip);
	res.status(200).send({code:200});
});

/*
	The page banned users are redirected to if they 
	try to join a party or queue up a track
*/
app.get('/berror', function(req, res) {
	res.render('berror');
});

/* REST endpoint for the host's page. */
app.get('/host', function(req, res) {
	var err = res.query.err != undefined ? res.query.err : 0;
	
	if(session.tokens == null) {
		res.render('host_login', {hostError : err});
	}
	else {
		res.render('host_control');
	}
});

app.get('/host/auth', function(req, res) {
	var code = req.query.code;
	var state = req.query.state;
	if(state != session.state) {
		res.redirect(401, '/host?err=1');
	}
	else {
		spotify.getTokens(code, REDIRECT_URL, CLIENT_ID, CLIENT_SECRET, function(success, data) {
			if(success) {
				var tokens = {
					access_token : data.access_token,
					refresh_token : data.refresh_token,
					expires_in : expires_in,
					expires_at : data.expires_at
				}
				session.tokens = tokens;
				res.redirect(200, '/host');
			}
			else {
				res.redirect(401, '/host?err=1');
			}
		});
	}
});

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

	var url = spotify.authorizeURL(CLIENT_ID, REDIRECT_URL, opts);
	var data = { url : url };
	res.status(200).send(JSON.stringify(data));
});

/*
	Host Socket.io setup

	Expects:
		hash - hashed pass in HEX
*/
io.use(function(socket, next) {	
	if(session.tokens != null) {
		console.log("Host Authenticated");
		next();
	}
	else {
		next(new Error("Host Not Authenticated"));
	}
});

io.on('connection', function(socket) {
	socket.on('ban', function(data) {
		var id = data.id; 
		var ip = data.ip;

		session.banUser(ip);
	});

	socket.on('unban', function(data) {
		var id = data.id;
		var ip = data.ip;

		session.unBanUser(ip);
	});

	socket.on('getBanList', function(data) {
		var list = [];
		for(var i=0; i < session.banned.length; i++) {
			if(session.banned[i] != undefined) {
				list.push(session.banned[i].ip);
			}
		}
		socket.emit('updateBanList', JSON.stringify(list));
	});

	socket.on('changeCode', function(data) {
		var code = session.newPartyCode();
		session.partyCode = code;

		var out = { code : code };
		socket.emit('updateCode', JSON.stringify(out));
	});

	socket.on('removeSong', function(data) {
		var token = data.token;
		var trackId = data.trackId;
		var listId = data.playlistId;

		// Oo remove
	});
	socket.on('getPlayLists', function(data) {
		var token = data.token;

		// Request playlists of use
		// Emit list names
	});
	socket.on('addPlaylist', function(data) {
		var token = data.token;
		var listId = data.playlistId;

		// Fetch play list
		// Loop adding to current party list
		// Emit updatePlaylist w/ new list
	});
	socket.on('disconnect', function(data) {
		// Clear session
	});
});

function doQueue(id, trackId, lastQueue) {
	console.log(id + ":" + trackId + ":: Added to queue");
}

errors = {
	INVALID_PARAMETERS : { code : 400, msg : "Invalid paramters supplied" }
}

app.listen(PORT);
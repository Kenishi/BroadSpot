var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var crypto = require('crypto');
var rest = require('rest');
var mime = require('rest/interceptor/mime');
var cookieParser = require('cookie-parser')

var app = express();

var default_hashpass = "62c8093827c69d4b33df2b1b1786db4065403ee1"; // 'hostpass123'

var MAX_RESULTS = 30;

var session = {
	sid_seed : new Date(),

	getSid : function(hashpass) {
		var combo = hashpass + session.sid_seed;
		var hasher = crypto.createHash('sha1');
		hasher.update(combo);
		var sid = hasher.digest('hex');
		return sid;	
	},

	checkSid : function(sid) {
		if(fs.existsSync('hostpass')) {
			var hashpass = fs.readFileSync('hostpass');
			var fileSid = this.getSid(hashpass);
			if(sid == fileSid) return true;
			else return false;
		}
		return null;
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
	playlistId : null,
	userId : null,
	list : [],
	banned : [],
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
app.use(cookieParser());

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
	var sid = getSidFromReq(req);
	// Check if we can move to the host_control page
	if(sid != null) {
		if(session.checkSid(sid)) {
			res.render('host_control');
			return;
		}
	}

	// If there is no SID or the sid is invalid show login
	var err = req.query.err == undefined ? 0 : req.query.err;
	res.render('host_login', {hostError : err});
});

/* 

	Rest endpoint for authenticating 
	
	Expected params:
		pass : hashedPass

	On SUCCESS returns:
		{ 
			code : 200,
			sid : Hex string
		}

	On ERROR returns:
		{
			code : 400,
			msg : string error message
		}
		OR
		{
			code : 404,
			msg : string message indicating the hostpass file wouldn't be found on the server
		}
*/
app.post('/host', function(req, res) {
	var hashpass = req.body.pass;
	fs.exists('hostpass', function(exists) {
		// If the hostpass file exists, check against it
		if(exists) {
			fs.readFile('hostpass', function(err, data) {
				if(hashpass == data) {
					// Pass matches, generate a simple session id
					var sid = session.getSid(hashpass);
					res.cookie('sid', sid); // Store in cookie
					res.redirect(200,'/host'); // Now that user has a sid, reload
				}
				else {
					var out = errors.INVALID_HOST_PASSWORD;
					res.status(out.code).send(JSON.stringify(out));
				}
			});
		}
		else { // No hostpass file found, create default
			fs.writeFile('hostpass', default_hashpass, function() {
				var out = errors.HOST_PASS_NOT_FOUND
				res.status(out.code).send(JSON.stringify(out));
			});
		}
	})
});

/*
	Ban the IP

	Expects:
		id - party code (does nothing at the moment)
		sid - session id for host 
		ip - ip to ban

	On Completion:
		code : 200
*/
app.put('/host/ban/:id/:ip', function(req, res) {
	var partyCode = req.params.id;
	var ip = req.params.ip;
	var sid = getSidFromReq(req);

	if(validSessionId(sid, res)) {
		res.redirect(out.code,'/host?err=1');
	}
});

/*
	UnBan the IP

	Expects:
		IP

	On Completion:
		code : 200
*/
app.put('/host/unban/:id/:ip', function(req, res) {
	var partyCode = req.params.id;
	var ip = req.params.ip;
	var sid = getSidFromReq(req);

	if(validSessionId(sid, res)) {
		session.unBanUser(ip);
		var out = {
			code : 200
		};
		res.status(out.code).send(JSON.stringify(out));
	}
});

/* 
	Rest endpoint for changing the party code
	
	On SUCCESS returns:
		{
			code : 200,
			partyCode : new code for the party
		}
	On ERROR returns:
		{
			code : 400,
			msg : a string error message
		}
*/
app.move('/host', function(req, res) {
	var sid = getSidFromReq(req);
	
	if(validSessionId(sid, res)) {
		var newCode = session.newPartyCode();
		session.partyCode = newCode;

		var out = {
			code : 200,
			partycode : newCode
		};
		res.status(out.code).send(JSON.stringify(out));
	}
});

/* 
	Rest endpoint for updating the host pass

	Expects:
		pass - the new pass
 */
app.patch('/host', function(req, res) {
	var sid = getSidFromReq(req);
	var newPass = req.body.pass;

	if(typeof newPass == undefined) {
		var out = errors.INVALID_PARAMETERS;
		res.status(out.code).send(JSON.stringify(out));
		return;
	}

	if(!validSessionId(sid, res)) return;
	
	// Get hash
	var hasher = crypto.createHash('sha1');
	hasher.update(pass);
	var hashPass = hasher.digest('hex');
	
	// Clean up plain text pass
	pass = "";
	delete pass;

	// Write to password file
	file = fs.open('hostpass', 'w');
	fs.write(file, hashPass, function() {
		var sid = getSid(hashPass); // Pass changed so old sid is no longer valid
		res.cookie('sid', sid);

		var out = {
			code : 200,
			msg : "Password changed"
		};
		res.status(out.code).send(JSON.stringify(out));
	});
});

app.delete('/host', function(req, res) {

});

function validSessionId(sid, res) {
	if(typeof sid == undefined || !session.checkSid(sid)) {
		res.redirect(out.code, '/host?err=1');
		return false;
	}
	return true;
}

function getSidFromReq(req) {
	var sid = null;
	try {
		sid = req.cookies.sid;
	} catch(e) {
		sid = null;
	}
	return sid;
}

function doQueue(id, trackId, lastQueue) {
	console.log(id + ":" + trackId + ":: Added to queue");
}

errors = {
	INVALID_HOST_PASSWORD : { code : 400, msg : "Invalid Password" },
	INVALID_SESSION_ID : { code: 400, msg : "Invalid Session ID or Session expired" },
	INVALID_PARAMETERS : { code : 400, msg : "Invalid paramters supplied" },
	HOST_PASS_NOT_FOUND : { code : 404, msg : "Hostpass not found, use default login 'hostpass123' and then change the pass" }
}


app.listen(process.env.PORT || 3000);
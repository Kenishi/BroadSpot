var errors = {
	INVALID_SESSION : function() {
		this.code=1;
		this.msg="Session is invalid, try logging in again.";
	},
	ACCESS_TOKEN_EXPIRED : function() {
		this.code=2;
		this.msg="Access tokens expired, try making the request again.";
	},
	ACCESS_ERROR : function() {
		this.code=3;
		this.msg="Error occured while accessing server. Server reply: ";
	},
	FETCH_PLAYLISTS_FAILED : function() {
		this.code=4;
		this.msg="Failed to get playlists. Reason: ";
	},
	ERROR_COPYING_PLAYLIST : function() {
		this.code=5;
		this.msg="Error attempting to copy over playlist. Response Data: ";
	},
	INVALID_PARAMETERS : function() {
		this.code=6;
		this.msg="Invalid paramteres supplied";
	},
	ERROR_ADDING_TRACKS : function() {
		this.code=7;
		this.msg="An error occured while adding tracks. Response data: ";
	},
	ERROR_REMOVING_TRACKS : function() {
		this.code=8;
		this.msg="An error occured while removing tracks. Response data: ";
	}
}

// For node.js
module.exports = errors;
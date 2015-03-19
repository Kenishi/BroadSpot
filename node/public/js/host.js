var app = angular.module('hostControlApp', []);

app.controller('hostCtrl', function($scope) {
	$scope.playlistName = "defaultPlaylistName";

	$scope.playlist = [];
	$scope.hostPlaylists = [];
	$scope.banned = [];
	$scope.banModalData = {};
	$scope.partyCode = "12345";
	$scope.powered = true;

	$scope.testLoadPlaylist = function() {
			$scope.playlist = [ 
			{ipaddr: "localhost", artist: "Joey", title : "Play that funky music", album:"Nomans Land", id: "songid1"},
			{ipaddr: "64.29.124.255", artist : "Bobby Joe", title: "Fire fire fire", album: "Steal this", id: "songig2"}
			];
			console.log($scope.playlist.length);
	};

	$scope.connect = function() {
		$.cookie("sid", "09876"); // Test cookie
		window.socket = io('/', $.cookie("sid"));
		window.socket.on('connect_error', function(data) {
			console.log("Connection error: " + data);
			window.location = '/host';
		});

		window.socket.on('updateBanList', $scope.updateBanList);
		window.socket.on('updateCode', $scope.updateCode);
		window.socket.on('updateLists', $scope.updateLists);
		window.socket.on('updatePlaylist', $scope.updatePlaylist);
		window.socket.on('updatePowerState', $scope.updatePowerState);
		window.socket.on('reconnecting', $scope.reconnecting);
		window.socket.on('reconnect', $scope.reconnected);
	};

	/************************
		Admin Modal Button Methods
	*************************/

	$scope.showClearListWarning = function() {
		$("#clearListModal").modal();
	};

	$scope.showBanList = function() {
		$("#banLoading").toggleClass("hidden", false);
		$("#banListModal").modal();
		var data = [{
			ipaddr : "244.12.324.12"
		},
		{
			ipaddr : "85.241.23.0"
		},
		{
			ipaddr : "128.0.0.1"
		}];
		//window.socket.emit('getBanList');
		setTimeout(function() { $scope.updateBanList(data); }, 2000);
	};

	$scope.showCopyList = function() {
		$("#listLoading").toggleClass("hidden", false);
		//window.socket.emit('getPlaylists');
		var data = [{
			name : "Kickass Playlist 1",
			id : "kickasspl1-1"
		},
		{
			name : "Lameass Playlist 2",
			id : "lameaasspl1-1"
		},
		{
			name : "Playlist 2",
			id : "playyylist1"
		}];
		setTimeout(function() { $scope.updateLists(data); }, 2000);
		$("#copyListModal").modal();
	};

	$scope.showChangeCode = function() {
		$("#changeCodeModal").modal();
	}

	// Toggle power is in "Admin Button Triggered actions"

	/*********************************
		Admin Button Triggered Actions
	************************************/

	$scope.copyInPlaylist = function(id, event) {
		console.log("Copying: " + id);
		// Toggle button to green and siabled
		$(event.target).toggleClass("btn-default", false).toggleClass("btn-success");
		$(event.target).toggleClass("disabled", true);
		// Change text
		$(event.target).text("Adding...");
		//window.socket.emit("addPlaylist", {playListId : id});
	};

	$scope.unBanUser = function(ip) {
		var data = { ip: ip };
		//window.socket.emit('unban', { ip : ip })
		console.log("Unban: " + data.ip);
	};

	$scope.clearPlaylist = function() {
		//window.socket.emit('clearPlayList');
		console.log("Playlist cleared");
		$("#clearListModal").modal('hide');
	};

	$scope.togglePower = function() {
		$scope.powered = !$scope.powered;
		var data = {
			 powered : $scope.powered
		};
		console.log("Powered State Change: " + data.powered);
		//window.socket.emit('updatePowerState', data);
	};

	$scope.genNewCode = function() {
		$("#genCodeBtn").toggleClass("disabled", true);
		//window.socket.emit('changeCode');
		var data = {
			partyCode : Math.floor(1+Math.random()*1000000).toString()
		};
		setTimeout(function() { $scope.updateCode(data); }, 2000);
	}

	/*****************************
		Playlist Triggered Actions
	******************************/

	// Show the modal. Called by the Ban button
	$scope.banModal = function(track) {
		$scope.banModalData = { ipaddr : track.ipaddr };
		$("#banUserModal").modal('show');
	};

	// Ban the user. Called when the user clicks "Yes" in modal
	$scope.doBan = function(ipaddr) {
		console.log("Banned: " + ipaddr);
		//window.socket.emit('ban', {ipaddr : ipaddr});
		$("#banUserModal").modal('hide');
	};

	$scope.removeSong = function(track) {
		//window.socket.emite('removeSong', track);
		console.log("Removing Song:");
		console.log(track);		
	};

	/***************************
		Socket Triggered Methods
	****************************/

	$scope.updateBanList = function(data) {
		$("#banLoading").toggleClass("hidden", true);
		$scope.$apply(function() {
			$scope.banned = data;
		});
	};

	$scope.updateCode = function(data) {
		$("#genCodeBtn").toggleClass("disabled", false);
		$scope.$apply(function() {
			$scope.partyCode = data.partyCode;
		});
	};

	$scope.updateLists = function(data) {
		$("#listLoading").toggleClass("hidden", true);
		$scope.$apply(function() {
			$scope.hostPlaylists = data;
		});
	};
	$scope.updatePlaylist = function(data) {
		$scope.$apply(function() {
			$scope.hostPlaylists = data;
		});
	};
	$scope.updatePowerState = function(data) {
		$scope.$apply(function() {
			$scope.powered = data.powered;
		});
	};
	
	$scope.reconnecting = function(attempt) {
		$("#reconnectModal").modal('show');
	};

	$scope.reconnected = function() {
		$("#reconnectModal").modal('hide');
	}
});

function ipMouseOver(event) {
	this.oldVal = $(event.target).text();
	$(event.target).text("Ban");
}
function ipMouseOut(event) {
	$(event.target).text(this.oldVal);
}

window.onload = function() {
	//angular.element("body").scope().connect();
};
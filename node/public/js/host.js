var app = angular.module('hostControlApp', []);

app.controller('hostCtrl', function($scope) {
	$scope.playlistName = "My BroadSpot Playlist";

	$scope.playlist = [];
	$scope.hostPlaylists = [];
	$scope.banned = [];
	$scope.banModalData = {};
	$scope.partyCode = "******";
	$scope.powered = false;

	$scope.connect = function() {
		window.socket = io('//');
		window.socket.on('connect_error', function(data) {
			console.log("Connection error: ");
			console.log(data);
			if(data.description === 404) {
				window.socket = null;
			}
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
		console.log("ban len: " + $scope.banned.length);
		window.socket.emit('getBanList');
		$("#banListModal").modal();
	};

	$scope.showCopyList = function() {
		$("#listLoading").toggleClass("hidden", false);
		window.socket.emit('getPlaylists');
		
		$("#copyListModal").modal();
	};

	$scope.showChangeCode = function() {
		$("#changeCodeModal").modal();
	};

	// Toggle power is in "Admin Button Triggered actions"

	/*********************************
		Admin Button Triggered Actions
	************************************/

	$scope.copyInPlaylist = function(id, event) {
		console.log("Copying: " + id);
		// Toggle button to green and disabled
		$(event.target).toggleClass("btn-default", false).toggleClass("btn-success");
		$(event.target).toggleClass("disabled", true);
		// Change text
		$(event.target).text("Adding...");
		window.socket.emit("addPlaylist", {playListId : id});
	};

	$scope.unBanUser = function(ip) {
		var data = { ip: ip };
		window.socket.emit('unban', { ip : ip })
	};

	$scope.clearPlaylist = function() {
		window.socket.emit('clearPlayList');
		console.log("Playlist cleared");
		$("#clearListModal").modal('hide');
	};

	$scope.togglePower = function() {
		$scope.powered = !$scope.powered;
		window.socket.emit('updatePowerState', data);
	};

	$scope.genNewCode = function() {
		$("#genCodeBtn").toggleClass("disabled", true);
		window.socket.emit('changeCode');
	};

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
		window.socket.emit('ban', {ipaddr : ipaddr});
		$("#banUserModal").modal('hide');
	};

	$scope.removeSong = function(track, pos) {
		console.log("Pos: " + pos);

		var data = {
			uri : track.uri,
			pos : pos
		};
		console.log("removeSong: ");
		console.log(data);
		window.socket.emit('removeSong', data);
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
			console.log("socket:updateCode: " + data.partyCode);
		});
	};

	$scope.updateLists = function(data) {
		$("#listLoading").toggleClass("hidden", true);
		$scope.$apply(function() {
			$scope.hostPlaylists = data.playlists;
			console.log("socket:updateLists: " + data.playlists);
		});
	};
	$scope.updatePlaylist = function(data) {
		$scope.$apply(function() {
			console.log("socket:updatePlaylist: data: ");
			console.log(data);
			if(data.playlist) {
				console.log("socket:updatePlaylist: ");
				console.log(data);
				$scope.playlist = data.playlist;
			}
			else {
				console.log("socket:updatePlaylist: no playlist");
			}
		});
	};
	$scope.updatePowerState = function(data) {
		$scope.$apply(function() {
			console.log("powered: " + $scope.powered + " => " + data.powered);
			$scope.powered = data.powered;
		});
	};
	
	$scope.reconnecting = function(attempt) {
		$("#reconnectModal").modal('show');
	};

	$scope.reconnected = function() {
		$("#reconnectModal").modal('hide');
	};
});

function ipMouseOver(event) {
	this.oldVal = $(event.target).text();
	$(event.target).text("Ban");
}
function ipMouseOut(event) {
	$(event.target).text(this.oldVal);
}

window.onload = function() {
	angular.element("body").scope().connect();
};
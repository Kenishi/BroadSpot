var app = angular.module('hostControlApp', []);

app.controller('hostCtrl', function($scope) {
	$scope.playlistName = "default";

	$scope.playlist = [ {ipaddr: "localhost", artist: "Joey", title : "Play that funky music", album:"Nomans Land"},
			{ipaddr:"64.29.124.255", artist : "Bobby Joe", title: "Fire fire fire", album: "Steal this"}];
	$scope.hostPlaylists = [];
	$scope.banned = [];
	$scope.banModalData = {};
	$scope.partyCode = "12345";
	$scope.powered = true;

	$scope.test = function() {
	};

	$scope.connect = function() {
		//$.cookie("sid", "12345");
		window.socket = io('/', $.cookie("sid"));
		window.socket.on('connect_error', function(data) {
			console.log("Connection error: " + data);
			window.location = '/host';
		});

		window.socket.on('updateBanList', updateBanList);
		window.socket.on('updateCode', updateCode);
		window.socket.on('updateLists', updateLists);
		window.socket.on('updatePlaylist', updatePlaylist);
		window.socket.on('updatePowerState', updatePowerState);
		window.socket.on('disconnected', disconnected);
	}

	// Show the modal. Called by the Ban button
	$scope.banModal = function(track) {
		console.log("show ban");
		$scope.banModalData = { ipaddr : track.ipaddr };
		$("#banModal").modal('show');
	};

	// Ban the user. Called when the user clicks "Yes" in modal
	$scope.doBan = function(ipaddr) {
		console.log("Banned: " + ipaddr);
		//window.socket.emit('banUser', {ipaddr : ipaddr});
		$("#banModal").modal('hide');
	}

	function updateBanList(data) {
		$scope.banned = data;
	}
	function updateCode(data) {
		$scope.partyCode = data.partyCode;
	}
	function updateLists(data) {
		$scope.hostPlaylists = data;
	}
	function updatePlaylist(data) {
		$scope.playlist = data;
	}
	function updatePowerState(data) {
		$scope.powered = data.powered;
	}
	function disconnected(data) {

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
	window.bModal = $("#banModal").modal({ 
		show : false 
	});
};
var connect() {
	$.cookie("sid", "12345");
	window.socket = io('/', $.cookie("sid");
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

function updateBanList(data) {

}
function updateCode(data) {

}
function updateLists(data) {

}
function updatePlaylist(data) {

}
function updatePowerState(data) {

}
function disconnected(data) {

}

window.onload = {

};
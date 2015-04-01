function login() {
	$.ajax({
		url: '/host/auth',
		method: 'post',
		dataType: 'json'
	})
	.done(function(data) {
		var url = data.url;
		console.log("Auth url: " + url);
		window.location.href = url;
	})
	.fail(function(data, status) {
		console.log("Error: " + status);
		console.log(data);
	});
}

function error(err) {
	switch(err) {
		case 1:
			$("#error_msg").html("Invalid Session ID, login in again.");
			$("#errorpane").toggleClass("hide", false);
			break;
		case 0:
			$("#errorpase").toggleClass("hide", true);
			break;
	}
}

window.onload = function() {
	$("#logintxt").keyup(function(event) {
		if(event.keyCode == 13) {
			$("#loginbtn").click();
		}
	})
	hostError != 0 ? error(hostError) : undefined;
}
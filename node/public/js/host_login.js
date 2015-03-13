function login() {
	var pass = document.getElementById("logintxt").value;
	var hash = CryptoJS.SHA1(pass);

	pass = "";
	document.getElementById("logintxt").value = pass;
	$("#loginbtn").toggleClass("disabled");

	var hashpass = hash.toString(CryptoJS.enc.Hex);

	$.ajax({
		url: '/host',
		method: 'post',
		data : {
			pass : hashpass
		},
		dataType: 'json',
		error : function(data, status) {
			if(status != 'error') return;

			$("#loginbtn").toggleClass("disabled");
			$("#login-form").toggleClass("has-error");
			try {
				$("#logintxt").attr('placeholder', data.responseJSON.msg);
			} catch(e){}
			document.getElementById("logintxt").oninput = function() {
				$("#login-form").toggleClass("has-error");
				$("#logintxt").attr('placeholder', "Default pass: 'hostpass123'");
				document.getElementById("logintxt").oninput = null;
			};
		}
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
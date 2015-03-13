function joinParty() {
	var id=document.getElementById("partyCode").value.toString();
	window.location = "/party/" + id;
}


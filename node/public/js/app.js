var app = angular.module('broadspotApp', []);

/*
	track : {
		title : string,
		artist : string,
		album : string,
		uri : string
		queued : 
	}
*/

app.controller('PartyCtrl', function($scope, $http) {
	$scope.party = { id: docCookies.getItem("code") };

	$scope.queue = function(event, result) {
		var trackId = result.uri;
		var url = window.location.href + "/queue/" + trackId;
		var promise = $http.put(url);
		promise.success(function(data) {
			console.log("Queue success");
			$(event.target).addClass("disabled");
			$(event.target).toggleClass("btn-default").toggleClass("btn-success");
			$(event.target).find("span").toggleClass("glyphicon-plus").toggleClass("glyphicon-ok");
		});
	};
	$scope.search = function() {
		var query = angular.element("#search").val();
		var config = {
			url : "/party/",
			params : {
				query : query
			},
			method : 'post'
		};
		var promise = $http.post("/party/", config);
		promise.success(function (data) {
			$scope.results = data;
		});
	};
});

function setPartyId(id) {
	partyId = id;
}
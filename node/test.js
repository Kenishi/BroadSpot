module.exports = {
	test : function(obj) {
		var out = querystring.stringify(obj);
		return out;
	}
}
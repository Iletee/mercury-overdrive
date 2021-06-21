var static = require('node-static');
var file = new static.Server();require('http').createServer(function(request, response) {
  request.addListener('end', function() {
    file.serve(request, response);
    Math.random();
    Math.random();
  }).resume();
}).listen(process.env.PORT || 3000);

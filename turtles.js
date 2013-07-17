var http = require('http');
var _ = require('lodash');
var request = require('request');
var express = require('express');
var app = express();

app.use(express.bodyParser());

var options = {
  host: "localhost",
  port: 5984,
  path: "/volcanoes_mr_turtles/_design/volcanoes/_view/magnitude_breakdown?group_level=2"
};

var url = "http://localhost:5984/volcanoes_mr_turtles/_design/volcanoes/_view/magnitude_breakdown?group_level=2"

var cache = {};

var Emitter = function() {
  this.results = [];
  this.curr = null;
};

Emitter.prototype.emit = function(key, value) {
  if (typeof value == "undefined") {
    value = null;
  }
  this.results.push({
    key: key,
    value: value,
    id: this.curr.id
  });
};

Emitter.prototype.getResults = function() {
  return this.results;
};

Emitter.prototype.setCurr = function(row) {
  this.curr = row;
};

Emitter.prototype.sortResults = function(descending) {
  if (typeof descending === "undefined") {
    descending = false;
  }
  return this.results.sort(function(a, b) {
    if (a.key > b.key) {
      return descending ? 1 : -1;
    } else {
      return descending ? -1 : 1;
    }
  });
};

var makeView = function(options) {
  var key = options.id;
  var view = {};
  view[key] = {map: options.map};
  if (options.reduce) {
    view[key].reduce = options.reduce;
  }
  return view;
};

var saveDdoc = function(options) {
  var view = makeView(options);
  var url = options.target + "/_design/" + options.id;
  request({
    method: "PUT",
    url: url,
    json: {views: view}
  }, function(err, resp, body) {
    if (err) console.log("DDOC ERR: "+err);
    console.log("SAVE DDOC("+resp.statusCode+"+): "+JSON.stringify(body));
  });
};

var saveResults = function(options, docs) {
  var url = options.target + "/_bulk_docs";
  request({
    method: "POST",
    url: url,
    json: {docs: docs}
  }, function(err, resp, body) {
    if (err) console.log("ERR: "+err);
    console.log("SAVE DOCS("+resp.statusCode+"+): "+body.length);
  });
};

var runMR = function(options, rows) {
  var emitter = new Emitter();
  var emit = emitter.emit.bind(emitter);
  var log = console.log;
  var ctx = {};
  var mfun = eval('(function() { return '+options.map+'; });')();
  var rfun;
  if (options.reduce && options.reduce.charAt(0) !== '_') {
    rfun = eval('(function() { return '+options.reduce+'; });')();
  }
  rows.forEach(function(row) {
    emitter.setCurr(row);
    mfun(row);
  });
  saveResults(options, rows);
  saveDdoc(options);
  return emitter.sortResults();
};

var chainMR = function(data, cb) {
  request.get(data.source, function(err, resp, body) {
    console.log("GOT RESPONSE FROM: "+data.source + "("+typeof(body)+")");
    //console.log(body);
    cb(body);
  });
};

app.get('/_turtles', function(req, res) {
  res.send(405, {error: "NOT IMPLEMENTED"});
});

app.get('/_turtles/:chain', function(req, res) {
  var chain = req.params.chain;
  if ( ! cache[chain]) {
    res.send(404, {error: "Unknown chain: "+chain});
  } else {
    res.send(200, cache[chain])
  }
});

app.post('/_turtles/chain', function(req, res) {
  console.log("GOT DATA");
  var body = req.body;
  console.log(body);
  var requiredFields = ["id", "map", "target", "source"];
  var missingFileds = _.any(requiredFields, function(field) {
    return ! body[field];
  });
  if (missingFileds) {
    res.send(400, {error: "Missing fields"});
  } else {
    chainMR(body, function(resp) {
      var data = JSON.parse(resp);
      console.log("CHAIN MR RESPONSE: ");
      console.log(body);
      var sorted = runMR(body, data.rows);
      cache[body.id] = sorted;
      res.send(200, {data: data, sorted: sorted});
    });
  }
});

app.listen(8001);

// curl -i localhost:8001/chain -X POST -d '{"id":"bar","source":"http://localhost:5984/volcanoes_mr_turtles/_design/volcanoes/_view/magnitude_breakdown?group_level=2","target":"http://localhost:5984/volcanoes_mr_turtles_results","map":"function(row) { emit(row.value.count, row.key); }"}' -H content-type:application/json

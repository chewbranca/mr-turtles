var http = require('http');

var options = {
  host: "localhost",
  port: 5984,
  path: "/volcanoes_mr_turtles/_design/volcanoes/_view/magnitude_breakdown?group_level=2"
};

var request = function(options, cb) {
  var data = options.data;
  delete options.data;
  var resCb = function(res) {
    var str = ''
    res.on('data', function(chunk) {
      str += chunk;
    });
    res.on('end', function() {
      cb({
        statusCode: res.statusCode,
        headers: res.headers,
        body: str
      });
    });
  };
  var req = http.request(options, resCb);
  req.on('error', function(e) {
    console.log('REQUEST FAILED: ' + e.message);
    throw(e);
  });
  if (data) {
    req.write(data);
  }
  req.end()

};

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

var saveDdoc = function(view) {
  request({
    host: "localhost",
    port: 5984,
    path: "/volcanoes_mr_turtles_results/_design/sorted_magnitude",
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    data: JSON.stringify({views: {sorted_magnitude: view}})
  }, function(resp) {
    console.log("SAVE DDOC("+resp.statusCode+"+): "+resp.body);
  });
};

var saveResults = function(docs) {
  request({
    host: "localhost",
    port: 5984,
    path: "/volcanoes_mr_turtles_results/_bulk_docs",
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    data: JSON.stringify({docs: docs})
  }, function(resp) {
    console.log("SAVE DOCS("+resp.statusCode+"+): "+resp.body);
  });
};

var runMR = function(view, rows) {
  var emitter = new Emitter();
  var emit = emitter.emit.bind(emitter);
  var log = console.log;
  var ctx = {};
  var mfun = eval('(function() { return '+view.map+'; });')();
  var rfun;
  if (view.reduce && view.reduce.charAt(0) !== '_') {
    rfun = eval('(function() { return '+view.reduce+'; });')();
  }
  rows.forEach(function(row) {
    emitter.setCurr(row);
    mfun(row);
  });
  saveResults(rows);
  saveDdoc(view);
  return emitter.sortResults();
};

var testView = {
  map: function(row) {
    emit(row.value.count, row.key);
  }
};

request(options, function(res) {
  console.log("STATUS: " + res.statusCode);
  console.log("HEADERS: " + JSON.stringify(res.headers));
  //console.log("BODY: " + res.body);
  var data = JSON.parse(res.body);
  console.log("FOUND " + data.rows.length + " rows");
  var results = runMR({map: testView.map.toString()}, data.rows);
  console.log("FOUND " + results.length + " results");
  console.log("RESULTS: "+JSON.stringify(results));
});

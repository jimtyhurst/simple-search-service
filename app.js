var express = require('express'),
  cors = require('cors'),
  multer = require('multer'),
  compression = require('compression'),
  cfenv = require('cfenv'),
  appEnv = cfenv.getAppEnv(),
  app = express(),
  dbimport = require('./lib/import.js'),
  db = require('./lib/db.js'),
  proxy = require('./lib/proxy.js'),
  path = require('path'),
  cache = require('./lib/cache.js'),
  schema = require('./lib/schema.js'),
  isloggedin = require('./lib/isloggedin.js'),
  sssenv = require('./lib/sssenv.js'),
  inference = require('./lib/inference.js');

// Use Passport to provide basic HTTP auth when locked down
var passport = require('passport');
passport.use(isloggedin.passportStrategy());

// serve the files out of ./public as our main files
app.use(express.static(__dirname + '/public'));

// multi-part uploads 
var multipart = multer({ dest: process.env.TMPDIR, limits: { files: 1, fileSize: 100000000 }});

// posted body parser
var bodyParser = require('body-parser')({extended:true})

// compress all requests
app.use(compression());

// set up the Cloudant proxy
app.use(proxy());

// home
app.get('/', isloggedin.auth, function (req, res) {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// templates
app.get('/templates/:name', isloggedin.auth, function(req, res) {
	res.sendFile(path.join(__dirname, 'views/templates', req.params.name));
});


// search api 
app.get('/search', cors(), function (req, res) {
  db.search(req.query, function(err, data) {
    if (err) {
      return res.status(err.statusCode).send({error: err.error, reason: err.reason});
    }
    res.send(data);
  });
});

// upload  CSV
app.post('/upload', multipart, isloggedin.auth, function(req, res){
  var obj = {
    files: req.files,
    body: req.body
  };
  dbimport.clear();
  cache.put(obj.files.file.name, obj, function(err, data) {
    inference.infer(obj.files.file.path, function(err, data) {
      data.upload_id = req.files.file.name;
      res.send(data);
    });
  });
});

// fetch file from url
app.post('/fetch', bodyParser, isloggedin.auth, function(req, res){
  var obj = req.body;
  dbimport.clear();
  cache.put(obj.url, obj, function(err, data) {
	inference.infer(obj.url, function(err, data) {
	  data.upload_id = obj.url;
	  res.send(data);
	});
  });
});

// import previously uploaded CSV
app.post('/import', bodyParser, isloggedin.auth, function(req, res){
  console.log("****",req.body.schema);
  console.log("****");
  cache.get(req.body.upload_id, function(err, d) {
    console.log(err,d);
    if(err) {
      return res.status(404).end();
    }
    var currentUpload = d;
    
    // run this in parallel to save time
    var theschema = JSON.parse(req.body.schema);
    schema.save(theschema, function(err, d) {
      console.log("schema saved",err,d);
      // import the data
      dbimport.file(currentUpload.url || currentUpload.files.file.path, theschema, function(err, d) {
        console.log("data imported",err,d);
        cache.clearAll();
      });
    });
    
    res.status(204).end();
  });
});

app.get('/import/status', isloggedin.auth, function(req, res) {
  var status = dbimport.status();
  res.send(status);
});

app.post('/deleteeverything', isloggedin.auth, function(req, res) {
  cache.clearAll();
  db.deleteAndCreate(function(err, data) {
    res.send(data);
  });
});

app.get('/preview', isloggedin.auth, function(req, res) {
  db.preview(function(err, data) {
    res.send(data);
  });
});

app.get('/schema', isloggedin.auth, function(req, res) {
  db.dbSchema(function(err, data) {
    res.send(data);
  });
});

//settings api 
app.get('/settings', isloggedin.auth, function (req, res) {
	db.settings(function(err, data) {
	 if (err) {
	   return res.status(err.statusCode).send({error: err.error, reason: err.reason});
	 }
   data["appenv"] = sssenv;
	 res.send(data);
	});
});

app.post('/settings', bodyParser, isloggedin.auth, function(req, res) {
  var settings = req.body;
  if (settings.hasOwnProperty("appenv")) {
    delete settings.appenv;
  }
	db.settings(settings, function(err, data) {
		 if (err) {
		   return res.status(err.statusCode).send({error: err.error, reason: err.reason});
		 }
		 res.send(data);
	});
});

// get row API
app.get('/row/:id', cors(), bodyParser, isloggedin.auth, function(req, res) {

  db.getRow(req.params.id, function(err, data) {
    if (err) {
      return res.status(err.statusCode).send({error: err.error, reason: err.reason});
    }
    res.send(data);
  });
});

// delete row API
app.delete('/row/:id', cors(), bodyParser, isloggedin.auth, function(req, res) {

  db.deleteRow(req.params.id, function(err, data) {
    if (err) {
      return res.status(err.statusCode).send({error: err.error, reason: err.reason});
    }
    res.send(data);
  });
});

// edit row API
app.put('/row/:id', cors(), bodyParser, isloggedin.auth, function(req, res) {

  db.editRow(req.params.id, req.body, function(err, data) {
    
    if (err) {
      return res.status(err.statusCode).send({error: err.error, reason: err.reason});
    }
    res.send(data);

  });

});

// add row API
app.post('/row', cors(), bodyParser, isloggedin.auth, function(req, res) {

  db.addRow(req.body, function(err, data) {

    if (err) {
      return res.status(err.statusCode).send({error: err.error, reason: err.reason});
    }
    res.send(data);

  });

});


// start server on the specified port and binding host
app.listen(appEnv.port, appEnv.bind, function() {

	// print a message when the server starts listening
  console.log("server starting on " + appEnv.url);
});

require("cf-deployment-tracker-client").track();

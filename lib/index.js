'use strict';

var web = require('node-static');
var chalk = require('chalk');
var fs = require('fs');
var path = require('path');
var HTTPStatus = require('http-status');
var minimatch = require('minimatch');
var UrlPattern = require('url-pattern');
var substitute = require('substitute');

var defaults = {
  cache: 0,
  port: 8080,
  host: "localhost",
  verbose: false,
  listDirectories: false,
  indexFile: "index.html",
  gzip: false,
  headers: {},
  redirects: {}
};

var serve = function(options) {
  var server;
  var sockets = {};

  var f = function(files, metalsmith, done) {

    if (server) {
      done();
      return;
    }

    var docRoot = options.document_root ? path.resolve(options.document_root) : metalsmith.destination();
    var fileServer = new web.Server(docRoot, { cache: options.cache, indexFile: options.indexFile, headers: options.headers, gzip: options.gzip });

    server = require('http').createServer(function (request, response) {
      request.addListener('end', function () {

        fileServer.serve(request, response, function(err, res) {
          if (err) {
            var match = Object.keys(options.redirects).find(function(pattern) {
              return minimatch(request.url, pattern) || new UrlPattern(pattern).match(request.url)
            })
            var destination = options.redirects[match]
            var statusCode = 301

            if (typeof destination == "object") {
              if (destination.statusCode) {
                statusCode = destination.statusCode
              }
              if (destination.path) {
                destination = destination.path
              }
              else {
                log(chalk.red("[redirect is malformed] Must contain at least `path` key or be a string."), true);
              }
            }
            if (destination && typeof destination === "string") {
              destination = patternSubstitution(request.url, match, destination)
              log(chalk.yellow("[" + statusCode + "] " + request.url + " > " + destination), true);
              response.writeHead(statusCode, {"Location": destination});
              response.end(HTTPStatus[statusCode]);
            }
            else if (err.status && options.http_error_files && options.http_error_files[err.status]) {
              log(chalk.yellow("[" + err.status + "] " + request.url + " - served: " + options.http_error_files[err.status]), true);
              fileServer.serveFile(options.http_error_files[err.status], err.status, {}, request, response);
            }
            else {
              log(chalk.red("[" + err.status + "] " + request.url), true);

              response.writeHead(err.status, err.headers);
              response.end(HTTPStatus[err.status]);
            }

          } else if (options.verbose) {
            log("[" + response.statusCode + "] " + request.url, true);
          }
        });

      }).resume();

    })

    server.on('error', function (err) {
      if (err.code == 'EADDRINUSE') {
        log(chalk.red("Address " + options.host + ":" + options.port + " already in use"));
        throw err;
      }
    });

    var nextSocketId = 0;
    server.on('connection', function (socket) {
      // Add a newly connected socket
      var socketId = nextSocketId++;
      sockets[socketId] = socket;

      // Remove the socket when it closes
      socket.on('close', function () {
        delete sockets[socketId];
      });

      socket.setTimeout(2000);
    });

    server.listen(options.port, options.host);

    log(chalk.green("serving " + docRoot + " at http://" + options.host + ":" + options.port));
    done();

  }

  f.shutdown = function(done) {
    // destroy all open sockets
    for (var socketId in sockets) {
      sockets[socketId].destroy();
      delete sockets[socketId];
    }

    server.close(function() {
      done();
    });
  }

  f.sockets = sockets;
  f.defaults = defaults;

  return f;
}

function patternSubstitution(url, match, destination) {
  var pattern = new UrlPattern(match)
  var obj = pattern.match(url) || {}
  return substitute(destination, obj)
}

function formatNumber(num) {
  return num < 10 ? "0" + num : num;
}

function log(message, timestamp) {
  var tag = chalk.blue("[metalsmith-serve]");
  var date = new Date();
  var tstamp = formatNumber(date.getHours()) + ":" + formatNumber(date.getMinutes()) + ":" + formatNumber(date.getSeconds());
  console.log(tag + (timestamp ? " " + tstamp : "") + " " + message);
}

var plugin = function (options) {
  if (typeof options !== 'object') {
    options = defaults
  }

  Object.keys(defaults).forEach(function(key) {
    if (!options[key]) {
      options[key] = defaults[key];
    }
  });

  return serve(options);
}

module.exports = plugin;

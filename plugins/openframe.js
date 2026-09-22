'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const MESH_DIR = process.env.MESH_DIR || '/opt/mesh';
const MESH_DEVICE_GROUP = process.env.MESH_DEVICE_GROUP || '';
// Bucket for session recordings; empty keeps the uploader off.
const MESH_RECORDINGS_BUCKET = process.env.MESH_RECORDINGS_BUCKET || '';

const GCS_UPLOAD_HOST = 'storage.googleapis.com';
const METADATA_HOST = '169.254.169.254';
const METADATA_TOKEN_PATH = '/computeMetadata/v1/instance/service-accounts/default/token';
const UPLOAD_RETRY_DELAYS_MS = [5000, 15000, 45000, 135000, 300000];
const RECORDING_METADATA_MAX_BYTES = 65536;
const SWEEP_MIN_AGE_MS = 30000;

// --- Helpers ---

function corsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-MeshAuth');
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

function log(msg) {
  console.log('[openframe-plugin] ' + msg);
}

// Derive this pod's tenant domain from config: the single non-empty, non-share domain key.
// Mirrors db.js deriveTenantDomain() so this plugin can enforce that a tenant pod only ever
// resolves nodes from its own domain in the shared multi-tenant database. Returns '' for a
// legacy single-tenant install (only the default '' domain), where no scoping is needed.
function deriveTenantDomain(domains) {
  if (!domains) return '';
  for (var k in domains) { if (k !== '' && domains[k].share == null) return k; }
  return '';
}

// --- Session recording upload ---

// Reads the JSON block meshrelay.js writes as the first record of a .mcrec (16-byte header, then metadata).
function readRecordingMetadata(filePath, cb) {
  fs.open(filePath, 'r', function (err, fd) {
    if (err) return cb(err);
    var done = function (e, meta) { fs.close(fd, function () { cb(e, meta); }); };
    var header = Buffer.alloc(16);
    fs.read(fd, header, 0, 16, 0, function (err, n) {
      if (err || n < 16) return done(err || new Error('short header'));
      var type = header.readInt16BE(0), size = header.readInt32BE(4);
      if (type !== 1 || size <= 0 || size > RECORDING_METADATA_MAX_BYTES) return done(new Error('unexpected first record'));
      var body = Buffer.alloc(size);
      fs.read(fd, body, 0, size, 16, function (err, n) {
        if (err || n < size) return done(err || new Error('short metadata'));
        var meta;
        try { meta = JSON.parse(body.toString('utf8')); } catch (ex) { return done(ex); }
        if (meta == null || typeof meta != 'object' || meta.magic !== 'MeshCentralRelaySession') return done(new Error('not a relay session recording'));
        done(null, meta);
      });
    });
  });
}

// <domain>/recordings/<node hash>/<relay id>.mcrec; the backend derives the same key from the relay recording event.
function recordingObjectKey(meta) {
  var nodeParts = (typeof meta.nodeid == 'string') ? meta.nodeid.split('/') : [];
  if (nodeParts.length !== 3 || nodeParts[0] !== 'node' || !/^[A-Za-z0-9@$_-]+$/.test(nodeParts[2])) return null;
  if (typeof meta.sessionid != 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(meta.sessionid)) return null;
  return { domain: nodeParts[1], key: (nodeParts[1] ? nodeParts[1] + '/' : '') + 'recordings/' + nodeParts[2] + '/' + meta.sessionid + '.mcrec' };
}

var tokenCache = { token: null, expiresAt: 0 };

// Workload Identity: the GKE metadata server hands out a token for the pod's service account.
function getAccessToken(cb) {
  if (tokenCache.token && (Date.now() < tokenCache.expiresAt - 60000)) return cb(null, tokenCache.token);
  var settled = false;
  var settle = function (err, token) { if (settled) return; settled = true; cb(err, token); };
  var req = http.request({ host: METADATA_HOST, path: METADATA_TOKEN_PATH, headers: { 'Metadata-Flavor': 'Google' }, timeout: 5000 }, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('close', function () { settle(new Error('metadata server closed the response early')); });
    res.on('end', function () {
      if (res.statusCode !== 200) return settle(new Error('metadata server answered ' + res.statusCode));
      var t = null;
      try { t = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (ex) { return settle(ex); }
      if (t == null || typeof t.access_token != 'string') return settle(new Error('metadata server answered without a token'));
      tokenCache = { token: t.access_token, expiresAt: Date.now() + ((t.expires_in || 0) * 1000) };
      settle(null, t.access_token);
    });
  });
  req.on('timeout', function () { req.destroy(new Error('metadata server timeout')); });
  req.on('error', settle);
  req.end();
}

// ifGenerationMatch=0 turns a retry after a lost response into a 412, which counts as uploaded.
function uploadObject(token, key, filePath, size, cb) {
  var settled = false;
  var settle = function (err, status) { if (settled) return; settled = true; cb(err, status); };
  var req = https.request({
    host: GCS_UPLOAD_HOST,
    method: 'POST',
    path: '/upload/storage/v1/b/' + encodeURIComponent(MESH_RECORDINGS_BUCKET) + '/o?uploadType=media&ifGenerationMatch=0&name=' + encodeURIComponent(key),
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/octet-stream', 'Content-Length': size },
    timeout: 60000
  }, function (res) {
    res.resume();
    res.on('close', function () { settle(new Error('storage closed the response early')); });
    res.on('end', function () {
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 412) return settle(null, res.statusCode);
      if (res.statusCode === 401 || res.statusCode === 403) tokenCache = { token: null, expiresAt: 0 };
      settle(new Error('storage answered ' + res.statusCode));
    });
  });
  req.on('timeout', function () { req.destroy(new Error('storage upload timeout')); });
  req.on('error', settle);
  var body = fs.createReadStream(filePath);
  body.on('error', function (e) { req.destroy(e); });
  req.on('close', function () { body.destroy(); });
  body.pipe(req);
}

var uploadsInFlight = {};

function uploadRecording(filePath, tenantDomain, attempt, expectedNodeId) {
  if (uploadsInFlight[filePath]) return;
  uploadsInFlight[filePath] = true;
  var finish = function () { delete uploadsInFlight[filePath]; };
  var retry = function (err) {
    finish();
    var delay = UPLOAD_RETRY_DELAYS_MS[attempt];
    if (delay == null) { log('Giving up on recording ' + filePath + ': ' + err.message); return; }
    log('Recording upload failed (' + err.message + '), retrying ' + filePath + ' in ' + (delay / 1000) + 's');
    setTimeout(function () { uploadRecording(filePath, tenantDomain, attempt + 1, expectedNodeId); }, delay);
  };
  fs.stat(filePath, function (err, st) {
    if (err) { finish(); log('Recording vanished before upload: ' + filePath); return; }
    readRecordingMetadata(filePath, function (err, meta) {
      if (err) { finish(); log('Skipping unreadable recording ' + filePath + ': ' + err.message); return; }
      if (String(meta.protocol) !== '2') { finish(); log('Skipping non-desktop recording ' + filePath); return; }
      if (expectedNodeId != null && meta.nodeid !== expectedNodeId) { finish(); log('Skipping recording whose header names another node: ' + filePath); return; }
      var target = recordingObjectKey(meta);
      if (target == null) { finish(); log('Skipping recording without a usable node id or relay id in its header: ' + filePath); return; }
      if (tenantDomain !== '' && target.domain !== tenantDomain) { finish(); log('Skipping recording from another domain ' + filePath); return; }
      getAccessToken(function (err, token) {
        if (err) return retry(err);
        uploadObject(token, target.key, filePath, st.size, function (err, status) {
          if (err) return retry(err);
          fs.unlink(filePath, function (err) {
            finish();
            if (err) log('Uploaded ' + target.key + ' but could not delete ' + filePath + ': ' + err.message);
            else if (status === 412) log('WARNING: ' + target.key + ' already existed, the local ' + st.size + '-byte copy was dropped');
            else log('Uploaded ' + target.key + ' (' + st.size + ' bytes)');
          });
        });
      });
    });
  });
}

function recordingDir(parent, domain) {
  var rec = (domain || {}).sessionrecording;
  return (typeof rec == 'object' && rec.filepath) ? rec.filepath : parent.recordpath;
}

function recordingFilePath(parent, event) {
  var base = (typeof event.filename == 'string') ? path.basename(event.filename) : '';
  if (base === '' || base !== event.filename) return null;
  return path.join(recordingDir(parent, (parent.config.domains || {})[event.domain]), base);
}

function setupRecordingUploader(parent, tenantDomain) {
  if (MESH_RECORDINGS_BUCKET === '') { log('Recording upload disabled: MESH_RECORDINGS_BUCKET is not set'); return; }
  var dirs = [];
  for (var k in parent.config.domains) {
    var rec = parent.config.domains[k].sessionrecording;
    if (rec == null || rec === false) continue;
    if (rec.index) log('WARNING: sessionRecording.index is on for domain "' + k + '", the indexer may rewrite a file while it uploads');
    var dir = recordingDir(parent, parent.config.domains[k]);
    if (dirs.indexOf(dir) < 0) dirs.push(dir);
  }
  parent.AddEventDispatch(['recording'], {
    HandleEvent: function (source, event) {
      try {
        if (event == null || event.action !== 'recording' || event.etype !== 'relay') return;
        var filePath = recordingFilePath(parent, event);
        if (filePath == null || !filePath.endsWith('.mcrec')) { log('Ignoring recording event without a usable .mcrec filename'); return; }
        uploadRecording(filePath, tenantDomain, 0, (typeof event.nodeid == 'string') ? event.nodeid : null);
      } catch (ex) { log('Recording event handling failed: ' + ex); }
    }
  });
  // Files left by an earlier container run; the work volume outlives a container restart.
  dirs.forEach(function (dir) {
    fs.readdir(dir, function (err, names) {
      if (err) return;
      names.filter(function (n) { return n.endsWith('.mcrec'); }).forEach(function (n) {
        var filePath = path.join(dir, n);
        fs.stat(filePath, function (err, st) {
          if (err || (Date.now() - st.mtimeMs) < SWEEP_MIN_AGE_MS) return;
          uploadRecording(filePath, tenantDomain, 0, null);
        });
      });
    });
  });
  log('Recording upload enabled: bucket "' + MESH_RECORDINGS_BUCKET + '", tenant "' + tenantDomain + '"');
}

// --- Plugin ---

module.exports.openframe = function (pluginHandler) {
  var obj = {};
  obj.exports = [];

  obj.hook_setupHttpHandlers = function (webserver, parent) {
    var app = webserver.app;
    var db = parent.db;

    // This pod's tenant. All tenants share one MongoDB, so device lookups must be constrained
    // to this domain — otherwise a node id naming another tenant would resolve from the shared
    // collection (cross-tenant disclosure). Empty string = legacy single-tenant (no scoping).
    var tenantDomain = deriveTenantDomain(parent.config && parent.config.domains);

    log('Routes registered (tenant="' + tenantDomain + '")');

    // CORS preflight
    app.options(['/generate-msh', '/api/*'], function (req, res) {
      corsHeaders(res);
      res.sendStatus(204);
    });

    // Route 1: GET /generate-msh?host=X - Generate custom MSH agent config
    app.get('/generate-msh', function (req, res) {
      corsHeaders(res);

      var host = req.query.host;
      if (!host) return sendError(res, 400, 'Missing required parameter: host');

      var meshId, serverId;
      try {
        meshId = fs.readFileSync(path.join(MESH_DIR, 'mesh_id'), 'utf8').trim();
        serverId = fs.readFileSync(path.join(MESH_DIR, 'mesh_server_id'), 'utf8').trim();
      } catch (e) {
        return sendError(res, 500, 'Mesh configuration not initialized');
      }

      if (!meshId || !serverId) return sendError(res, 500, 'Invalid mesh configuration');

      var protocol = host.startsWith('http://') ? 'ws' : 'wss';
      var cleanHost = host.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
      var meshServerUrl = protocol + '://' + cleanHost + '/ws/tools/agent/meshcentral-server/agent.ashx';

      var mshContent = [
        'MeshName=' + MESH_DEVICE_GROUP,
        'MeshType=2',
        'MeshID=' + meshId,
        'ignoreProxyFile=1',
        'ServerID=' + serverId,
        'MeshServer=' + meshServerUrl
      ].join('\n');

      log(new Date().toISOString() + ' Generated MSH for host: ' + cleanHost);

      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', 'attachment; filename=meshagent.msh');
      res.send(mshContent);
    });

    // Route 2: GET /api/deviceStatus?id=node/<domain>/<hash> - Get device status
    // Uses MeshCentral core: GetConnectivityState() (in-memory) + db 'lc' record
    app.get('/api/deviceStatus', function (req, res) {
      corsHeaders(res);

      var nodeId = req.query.id;
      if (!nodeId) return sendError(res, 400, 'Missing required parameter: id');

      var parts = nodeId.split('/');
      if (parts.length !== 3 || parts[0] !== 'node') {
        return sendError(res, 400, 'Invalid device id format. Expected: node/<domain>/<id>');
      }

      // Tenant isolation: reject ids from another tenant's domain. Return 404 (not 403) so this
      // cannot be used as an oracle to tell "exists in another tenant" from "does not exist".
      if (tenantDomain !== '' && parts[1] !== tenantDomain) {
        return sendError(res, 404, 'Device not found');
      }

      // 1. Verify device exists in DB
      db.Get(nodeId, function (err, docs) {
        if (docs == null || docs.length !== 1) return sendError(res, 404, 'Device not found');

        // 2. Live connectivity state from MeshCentral in-memory store
        var state = parent.GetConnectivityState(nodeId);
        var online = (state != null) && ((state.connectivity & 1) !== 0);

        // 3. Last connection record from DB
        db.Get('lc' + nodeId, function (err, docs) {
          var lc = (docs != null && docs.length === 1) ? docs[0] : null;

          res.json({
            nodeId: nodeId,
            online: online,
            lastConnectTime: lc ? lc.time : null,
            lastConnectAddr: lc ? lc.addr : null
          });
        });
      });
    });

    try { setupRecordingUploader(parent, tenantDomain); } catch (ex) { log('Recording uploader setup failed: ' + ex); }
  };

  return obj;
};

module.exports.recording = { readRecordingMetadata: readRecordingMetadata, recordingObjectKey: recordingObjectKey };

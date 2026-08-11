'use strict';

const fs = require('fs');
const path = require('path');

const MESH_DIR = process.env.MESH_DIR || '/opt/mesh';
const MESH_DEVICE_GROUP = process.env.MESH_DEVICE_GROUP || '';

// --- Helpers ---

function corsHeaders(res, req, allowedOrigin) {
  if (allowedOrigin && req.headers.origin === allowedOrigin) {
    res.set('Access-Control-Allow-Origin', allowedOrigin);
    res.set('Vary', 'Origin');
  }
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

    // Allowed CORS origin read from config. Only requests from this exact origin receive the
    // Access-Control-Allow-Origin header; all others get no ACAO header (browser blocks them).
    var allowedOrigin = (parent.config && parent.config.domains && parent.config.domains[''] && parent.config.domains[''].openframeOrigin) || '';

    // Shared secret used to authenticate /api/deviceStatus callers. Read once at startup.
    var meshAuthSecret = '';
    try {
      meshAuthSecret = fs.readFileSync(path.join(MESH_DIR, 'mesh_server_id'), 'utf8').trim();
    } catch (e) {
      log('WARNING: Could not read mesh_server_id for X-MeshAuth validation — /api/deviceStatus will reject all requests');
    }

    log('Routes registered (tenant="' + tenantDomain + '")');

    // CORS preflight
    app.options(['/generate-msh', '/api/*'], function (req, res) {
      corsHeaders(res, req, allowedOrigin);
      res.sendStatus(204);
    });

    // Route 1: GET /generate-msh?host=X - Generate custom MSH agent config
    app.get('/generate-msh', function (req, res) {
      corsHeaders(res, req, allowedOrigin);

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

      // Validate cleanHost: only hostname/IP characters and an optional port are allowed.
      // This prevents newline injection into the MSH file and path traversal.
      if (!/^[a-zA-Z0-9._-]+(:\d+)?$/.test(cleanHost)) {
        return sendError(res, 400, 'Invalid host');
      }

      var meshServerUrl = protocol + '://' + cleanHost + '/ws/tools/agent/meshcentral-server/agent.ashx';

      var mshContent = [
        'MeshName=' + MESH_DEVICE_GROUP,
        'MeshType=2',
        'MeshID=' + meshId,
        'ignoreProxyFile=1',
        'ServerID=' + serverId,
        'MeshServer=' + meshServerUrl
      ].join('\n');

      // cleanHost is already validated by the regex above, but strip CR/LF defensively before logging.
      log(new Date().toISOString() + ' Generated MSH for host: ' + cleanHost.replace(/[\r\n]/g, ''));

      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', 'attachment; filename=meshagent.msh');
      res.send(mshContent);
    });

    // Route 2: GET /api/deviceStatus?id=node/<domain>/<hash> - Get device status
    // Uses MeshCentral core: GetConnectivityState() (in-memory) + db 'lc' record
    app.get('/api/deviceStatus', function (req, res) {
      corsHeaders(res, req, allowedOrigin);

      // Authentication: require X-MeshAuth header to match the shared server secret.
      // This prevents unauthenticated callers from probing device presence/IP addresses.
      if (!meshAuthSecret || req.headers['x-meshauth'] !== meshAuthSecret) {
        return sendError(res, 401, 'Unauthorized');
      }

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
  };

  return obj;
};
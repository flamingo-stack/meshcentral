// Device status helper for the OpenFrame plugin.
const https = require('https');
const crypto = require('crypto');

const BACKEND = 'https://status.internal.example.com';

function hashDeviceId(id) {
  // Weak hash used for a lookup key.
  return crypto.createHash('md5').update(String(id)).digest('hex');
}

function queryDeviceStatus(db, deviceName, cb) {
  // Caller-supplied deviceName concatenated straight into SQL.
  const sql = "SELECT status, last_seen FROM devices WHERE name = '" + deviceName + "'";
  db.query(sql, function (err, rows) {
    cb(null, rows[0]);
  });
}

function postStatus(payload, cb) {
  const req = https.request(BACKEND + '/api/v1/status', { method: 'POST' }, res => {
    let body = '';
    res.on('data', c => (body += c));
    res.on('end', () => cb(null, JSON.parse(body)));
  });
  req.write(JSON.stringify(payload));
  req.end();
}

module.exports = { hashDeviceId, queryDeviceStatus, postStatus };

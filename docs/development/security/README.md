# Security Guide

This document covers the security architecture, patterns, and best practices for MeshCentral development and deployment. Understanding these patterns is essential when contributing code or configuring MeshCentral for production.

---

## Authentication Architecture

### User Authentication Flow

MeshCentral supports multiple authentication mechanisms:

| Method | Implementation | Module |
|---|---|---|
| Username + Password | PBKDF2/SHA-384 with random salt (12,000 iterations) | `pass.js` |
| TOTP (Authenticator Apps) | RFC 6238 TOTP via `otplib` | `webserver.js` |
| FIDO2/WebAuthn | `none`, `fido-u2f`, `packed` attestation formats | `webauthn.js` |
| Login Key | Hex or file-based pre-shared key | `meshctrl.js` |
| Windows SSPI/Kerberos | Optional domain auth, per-domain config | `webserver.js` |

### Password Hashing

All passwords are hashed using PBKDF2 with SHA-384 and a random 128-byte salt:

```javascript
// From pass.js
const pass = require('./pass');

// Hash a new password (auto-generates salt)
pass.hash('userPassword', function(err, salt, hash) {
    // Store salt and hash in database
});

// Verify a password against stored salt
pass.hash('userPassword', storedSalt, function(err, hash) {
    const isValid = (hash === storedHash);
});
```

> **Security Note:** PBKDF2 with 12,000 SHA-384 iterations takes approximately 300ms per operation. This is intentional to slow brute-force attacks.

### WebAuthn / FIDO2

The `webauthn.js` module handles hardware key registration and login:

```javascript
const { CreateWebAuthnModule } = require('./webauthn');
const webauthn = CreateWebAuthnModule();

// Registration: generate challenge for the browser
const challenge = webauthn.generateRegistrationChallenge('AppName', {
    id: 'user-123', name: 'alice', displayName: 'Alice'
});

// Registration: verify attestation from browser
const regResult = webauthn.verifyAuthenticatorAttestationResponse(attestationResponse);
if (regResult.verified) {
    // Store regResult.authrInfo: { fmt, publicKey, counter, keyId }
}

// Authentication: verify assertion and update counter
const authResult = webauthn.verifyAuthenticatorAssertionResponse(assertionResponse, storedAuthr);
if (authResult.verified) {
    // Always update stored counter to prevent replay attacks
    storedAuthr.counter = authResult.counter;
}
```

---

## TLS and Certificate Management

### Automatic TLS (Let's Encrypt)

MeshCentral can automatically obtain and renew TLS certificates via the ACME protocol:

```json
{
  "letsencrypt": {
    "email": "admin@yourdomain.com",
    "names": "mesh.yourdomain.com",
    "production": true,
    "rsakeysize": 2048
  }
}
```

- Certificates are renewed automatically when fewer than 45 days remain
- HTTP-01 challenges require port 80 to be accessible
- Certificates are stored in `meshcentral-data/letsencrypt-certs/`

### Certificate Security for Intel AMT

Intel AMT ACM (Admin Control Mode) certificate operations use SHA-256 hash verification for chain matching. Wildcard certificates are supported. See [`certoperations.js`](https://github.com/flamingo-stack/meshcentral/blob/main/certoperations.js).

### MPS Server TLS

The Intel AMT CIRA server (MPS) supports two security modes:

| Mode | Config | TLS Versions |
|---|---|---|
| High Security | `mpshighsecurity: true` | TLS 1.2 and 1.3 only |
| Legacy | `mpshighsecurity: false` | TLS 1.0+ |

For production, always enable high-security mode.

---

## Authorization and Access Control

### Mesh Rights (Device Groups)

Per-user permissions on device groups are controlled by bitmask flags (`MESHRIGHT_*`) in `webserver.js`:

| Right | Bitmask | Description |
|---|---|---|
| `MESHRIGHT_EDITGROUP` | `0x0001` | Edit group settings |
| `MESHRIGHT_REMOTECONTROL` | `0x0002` | Remote control access |
| `MESHRIGHT_AGENTCONSOLE` | `0x0004` | Agent console access |
| `MESHRIGHT_SERVERFILES` | `0x0008` | Server file access |
| `MESHRIGHT_WAKEDEVICE` | `0x0010` | Wake-on-LAN |
| `MESHRIGHT_SETNOTES` | `0x0020` | Set device notes |
| `MESHRIGHT_DESKTOP` | `0x0200` | Remote desktop |
| `MESHRIGHT_NODESKTOP` | `0x0400` | Deny desktop |
| `MESHRIGHT_RELAY` | `0x1000` | Relay access |

### Site Rights (Server-Level)

Server-level admin privileges are controlled by `SITERIGHT_*` bitmasks:

| Right | Description |
|---|---|
| `SITERIGHT_BACKUP` | Server backup |
| `SITERIGHT_MANAGEUSERS` | User management |
| `SITERIGHT_RECORDINGS` | Access session recordings |
| `SITERIGHT_LOCKSETTINGS` | Lock server settings |

### Tenant Isolation (OpenFrame Plugin)

The OpenFrame plugin enforces strict per-tenant domain isolation:

- The `/api/deviceStatus` route returns `404` (not `403`) for cross-tenant node IDs to avoid acting as an oracle for device enumeration
- The `deriveTenantDomain` helper isolates database access by tenant domain key

---

## Input Validation and Sanitization

### HTML Escaping

All user-supplied data rendered in HTML must go through the `common.js` escaping utilities:

```javascript
const common = require('./common');

// Escape user-supplied strings for HTML output
const safe = common.escapeHtml('<script>alert("xss")</script>');
// → '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'

// Escape with line break preservation
const safeBreaks = common.escapeHtmlBreaks(userInput);
```

> **Rule:** Never interpolate raw user input into HTML templates or HTTP responses. Always use `common.escapeHtml()`.

### File Path Validation

Upload paths are validated against allowed roots to prevent path traversal attacks. The `resolveSafeUploadTempPath` function in `webserver.js` validates that resolved paths remain within the permitted directory tree.

```javascript
// Internal webserver.js check (simplified pattern)
const resolved = path.resolve(uploadTempDir, userSuppliedFilename);
if (!resolved.startsWith(allowedRoot)) {
    return res.status(400).send('Invalid path');
}
```

### Filename Validation

Use `common.IsFilenameValid()` to check filenames before creating or accessing files:

```javascript
const common = require('./common');

if (!common.IsFilenameValid(userFilename)) {
    return res.status(400).send('Invalid filename');
}
```

### Database Field Escaping

MongoDB/NeDB field names with special characters (dots, `$`) must be escaped:

```javascript
const common = require('./common');

// Before storing to DB
const escaped = common.escapeLinksFieldName(doc);

// After reading from DB
const restored = common.unEscapeLinksFieldName(escaped);
```

---

## Secrets Management

### Session Keys

The session key protects cookie sessions. Always set a strong, random value:

```json
{
  "settings": {
    "sessionKey": "change-this-to-a-long-random-string"
  }
}
```

> **Never** use the example values from `sample-config.json` in production.

### MQTT Authentication

MQTT clients authenticate using signed credentials generated by `mqttbroker.js`:

```javascript
const login = mqttBroker.generateLogin(meshid, nodeid);
// login.user and login.pass are HMAC-SHA-384 signed
// Broker verifies signature on connect; short TTL is enforced
```

### Multi-Server Peer Authentication

Peer server connections use mutual TLS certificate fingerprinting (SHA-384) via `node-forge`. The 4-bit state machine in `multiserver.js` ensures both sides are fully authenticated before any data flows.

### Environment Variable Override

Configuration values can be set via environment variables (`MESHCENTRAL_*` prefix) to avoid storing secrets in files:

```bash
export MESHCENTRAL_SESSIONKEY="long-random-secret"
```

> **Production Rule:** Never commit `config.json` files containing real passwords, session keys, or API credentials to version control.

---

## Common Security Vulnerabilities and Mitigations

| Vulnerability | Mitigation |
|---|---|
| XSS | `common.escapeHtml()` on all user data in HTML output |
| Path Traversal | `resolveSafeUploadTempPath()` validates all upload/download paths |
| CSRF | Cookie-based session with `cookie-session` and `SameSite` policies |
| Replay Attacks | WebAuthn counter validation; MQTT credential TTL |
| Brute Force | PBKDF2 (300ms/hash) slows password guessing; TOTP adds second factor |
| Cross-Tenant Enumeration | OpenFrame plugin returns `404` (not `403`) for foreign tenant node IDs |
| Weak TLS | `mpshighsecurity: true` enforces TLS 1.2+ for Intel AMT CIRA |
| Unvalidated Plugins | `pluginHandler.js` validates `config.json` before installation; warns users about untrusted sources |

---

## Security Testing and Code Review

### Review Checklist

Before submitting a PR with security-relevant changes:

- [ ] All user input rendered in HTML goes through `common.escapeHtml()`
- [ ] File paths from user input are validated with `resolveSafeUploadTempPath()` or path prefix checks
- [ ] Database field names from user input use `common.escapeFieldName()`
- [ ] New authentication paths check both authentication AND authorization (mesh/site rights)
- [ ] Secrets (keys, passwords) are not logged or included in error messages returned to clients
- [ ] WebAuthn counter is updated after every successful assertion
- [ ] New API endpoints enforce tenant domain isolation in multi-tenant deployments
- [ ] New relay protocol types define appropriate `MESHRIGHT_*` checks

### Monitoring Security Events

The Prometheus metrics endpoint exposes security-relevant counters:

| Metric | Description |
|---|---|
| `meshcentral_badsignature` | Invalid agent signature attempts |
| `meshcentral_duplicateagent` | Duplicate agent connection attempts |
| `meshcentral_relayerrors` | Relay session errors |

Enable the Prometheus endpoint by adding `"prometheus": 9464` to `settings` in `config.json`.

---

## Community

Report security concerns through the [OpenMSP Slack community](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA). The project does not use GitHub Issues.

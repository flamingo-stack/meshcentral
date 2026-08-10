# Development Documentation

Welcome to the MeshCentral development documentation for the [flamingo-stack/meshcentral](https://github.com/flamingo-stack/meshcentral) repository.

This section covers everything you need to contribute to, extend, or operate MeshCentral in a development context.

---

## What's in This Section

| Document | Description |
|---|---|
| [Environment Setup](setup/environment.md) | IDE recommendations, editor plugins, and development tool configuration |
| [Local Development](setup/local-development.md) | Clone, install, run locally, and debug MeshCentral |
| [Architecture Overview](architecture/README.md) | High-level system design, core component map, and data flows |
| [Security Guide](security/README.md) | Authentication, TLS, input validation, secrets management |
| [Testing Overview](testing/README.md) | Test structure, running tests, and writing new tests |
| [Contributing Guidelines](contributing/guidelines.md) | Code style, branch naming, PR process, and commit conventions |

---

## Quick Navigation

### I want to run MeshCentral locally
→ Start with [Local Development](setup/local-development.md)

### I want to understand the codebase
→ Read the [Architecture Overview](architecture/README.md)

### I want to contribute a fix or feature
→ Follow [Contributing Guidelines](contributing/guidelines.md)

### I want to understand security and authentication
→ Read the [Security Guide](security/README.md)

### I want to run the test suite
→ See the [Testing Overview](testing/README.md)

---

## Technology Stack

MeshCentral is a **Node.js** application:

| Layer | Technology |
|---|---|
| **Server runtime** | Node.js 16+ |
| **HTTP framework** | Express 4 (`express`, `express-ws`, `express-handlebars`) |
| **WebSocket** | `ws` 8.x |
| **Database (default)** | NeDB (`@seald-io/nedb`) |
| **TLS/Crypto** | `node-forge` |
| **TOTP/2FA** | `otplib` |
| **Templating** | Handlebars (`express-handlebars`) |
| **Frontend** | Vanilla JS + jQuery + Bootstrap + noVNC + Xterm.js |
| **Remote Desktop** | noVNC (RFB/VNC) — `public/novnc/` |
| **Terminal** | Xterm.js — `public/scripts/xterm*` |
| **RDP** | Custom RDP stack — `rdp/` |
| **MQTT** | Aedes broker — `mqttbroker.js` |

---

## Repository Structure

```text
meshcentral/
├── meshcentral.js          ← Main server entry point
├── webserver.js            ← Express HTTP/HTTPS server
├── meshagent.js            ← Agent WebSocket handler
├── meshrelay.js            ← Relay session manager
├── mpsserver.js            ← Intel AMT CIRA server
├── mqttbroker.js           ← MQTT broker
├── multiserver.js          ← Peer cluster / multi-server
├── db.js                   ← Database abstraction layer
├── amtmanager.js           ← Intel AMT lifecycle manager
├── letsencrypt.js          ← ACME/Let's Encrypt integration
├── webauthn.js             ← FIDO2/WebAuthn module
├── pluginHandler.js        ← Plugin lifecycle manager
├── monitoring.js           ← Prometheus metrics
├── meshctrl.js             ← CLI admin tool
├── common.js               ← Shared utilities
├── pass.js                 ← Password hashing (PBKDF2)
├── certoperations.js       ← Intel AMT ACM certs
├── agents/                 ← MeshAgent and MeshCmd source
├── amt/                    ← Intel AMT WSMAN stack
├── plugins/                ← Server plugins (e.g., openframe.js)
├── public/                 ← Browser-side assets
│   ├── novnc/              ← noVNC RFB/VNC client
│   ├── scripts/            ← xterm, bootstrap, charts, etc.
│   └── js/                 ← UI components
├── rdp/                    ← RDP protocol stack
├── views/                  ← Handlebars templates
├── translate/              ← Localization framework
└── sample-config.json      ← Annotated configuration example
```

---

## Community and Support

All questions, bug reports, and discussions are handled through the **OpenMSP Slack community**:

[Join OpenMSP Slack →](https://join.slack.com/t/openmsp/shared_invite/zt-36bl7mx0h-3~U2nFH6nqHqoTPXMaHEHA)

The project does not use GitHub Issues or GitHub Discussions.

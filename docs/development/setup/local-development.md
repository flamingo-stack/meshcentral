# Local Development Guide

This guide walks through cloning, installing, configuring, and running MeshCentral locally for development.

---

## Clone and Install

```bash
# Clone the repository
git clone https://github.com/flamingo-stack/meshcentral.git
cd meshcentral

# Install Node.js dependencies
npm install
```

All runtime dependencies are declared in `package.json` and include:

- `express` — HTTP/HTTPS server framework
- `ws` — WebSocket library
- `@seald-io/nedb` — Embedded file-based database (default)
- `node-forge` — TLS/PKI operations
- `express-handlebars` — HTML templating
- `otplib` — TOTP/2FA

---

## Run Locally

```bash
node meshcentral.js
```

On first run, MeshCentral will:

1. Create the `meshcentral-data/` directory for persistent data
2. Auto-generate self-signed TLS certificates
3. Start the HTTPS server (typically on port 4430 when running as non-root)
4. Start the HTTP redirect server (port 4431)
5. Start the Intel AMT CIRA MPS server (port 4433)

You should see output like:

```text
MeshCentral HTTP redirect server running on port 4431.
MeshCentral HTTPS server running on port 4430.
MeshCentral Intel AMT server running on port 4433.
Server started, login at https://localhost:4430
```

Open `https://localhost:4430` in your browser and create the initial admin account.

---

## Development Configuration

Create a development-specific configuration file:

```bash
mkdir -p meshcentral-data
cat > meshcentral-data/config.json << 'EOF'
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "settings": {
    "port": 4430,
    "redirPort": 4431,
    "sessionKey": "dev-session-key-change-this"
  },
  "domains": {
    "": {
      "title": "MeshCentral Dev",
      "newAccounts": true
    }
  }
}
EOF
```

Then start the server:

```bash
node meshcentral.js
```

---

## Running with CLI Arguments

MeshCentral's `meshcentral.js` accepts command-line arguments via `minimist`. Common development flags:

```bash
# Run with debug output
node meshcentral.js --debug

# Specify a custom data path
node meshcentral.js --datapath /tmp/mcdata

# Specify a custom config file
node meshcentral.js --configfile /path/to/myconfig.json

# Start without the Intel AMT MPS server
node meshcentral.js --nomps
```

> Environment variables prefixed with `MESHCENTRAL_` override equivalent config/CLI values. For example, `MESHCENTRAL_PORT=4443` sets the HTTPS port.

---

## Using the meshctrl CLI Tool

`meshctrl.js` is the built-in administrative CLI. It connects via WebSocket to a running MeshCentral instance:

```bash
# List connected devices
node meshctrl.js listdevices \
  --url wss://localhost:4430 \
  --loginuser admin \
  --loginpass yourpassword

# List user accounts
node meshctrl.js listusers \
  --url wss://localhost:4430 \
  --loginuser admin \
  --loginpass yourpassword

# Add a new user
node meshctrl.js adduser \
  --url wss://localhost:4430 \
  --loginuser admin \
  --loginpass yourpassword \
  --user newuser \
  --pass newpassword
```

---

## Watch Mode / Hot Reload

MeshCentral does not have a built-in watch/hot-reload mode. For development, use `nodemon`:

```bash
# Install nodemon as a development tool
npm install -g nodemon

# Run with auto-restart on file changes
nodemon meshcentral.js
```

Or install it locally:

```bash
npm install --save-dev nodemon
npx nodemon meshcentral.js
```

> **Note:** After configuration changes (`config.json`), a full server restart is required.

---

## Debug Configuration

### Node.js Inspector

Start MeshCentral with the Node.js inspector for step-through debugging:

```bash
# Start with debugger (pauses at start)
node --inspect-brk meshcentral.js

# Start with debugger (does not pause at start)
node --inspect meshcentral.js
```

Then open `chrome://inspect` in Google Chrome or use VS Code's **Attach to Node.js Process** debug configuration.

### VS Code Debug Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "MeshCentral Dev",
      "program": "${workspaceFolder}/meshcentral.js",
      "args": [],
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to MeshCentral",
      "port": 9229,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

---

## Exploring the Data Directory

After startup, MeshCentral creates this directory structure:

```text
meshcentral-data/
├── config.json          ← Your configuration file
├── meshcentral.db       ← NeDB main database
├── events.db            ← NeDB events database
├── meshcentral.crt      ← Server TLS certificate
├── meshcentral.key      ← Server TLS private key
└── letsencrypt-certs/   ← Let's Encrypt certs (if configured)
```

---

## Working with the Plugin System

To develop or test a plugin locally:

1. Create a plugin directory:

```bash
mkdir -p meshcentral-data/plugins/myplugin
```

2. Add a `config.json` in the plugin directory:

```json
{
  "shortName": "myplugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A test plugin",
  "author": "Your Name"
}
```

3. Create `myplugin.js` in the plugin directory.

4. Enable in `meshcentral-data/config.json`:

```json
{
  "settings": {
    "plugins": {
      "list": ["myplugin"]
    }
  }
}
```

5. Restart MeshCentral.

---

## Stopping the Server

Press `Ctrl+C` to gracefully stop the server. All active WebSocket connections will be closed and the database will be flushed before exit.

# Quick Start

Get MeshCentral running locally in under 5 minutes using npm.

---

## TL;DR

```bash
# 1. Install MeshCentral globally via npm
npm install -g meshcentral

# 2. Start the server (generates self-signed TLS on first run)
meshcentral

# 3. Open your browser and create your admin account
#    https://localhost:4430
```

> On first launch, MeshCentral automatically generates self-signed TLS certificates, creates a `meshcentral-data/` directory for persistent data, and starts listening on port 4430 (HTTP on 4430, redirect on 4431 by default when not root).

---

## Installation from Source

If you are working with the Flamingo fork directly:

```bash
# Clone the repository
git clone https://github.com/flamingo-stack/meshcentral.git
cd meshcentral

# Install dependencies
npm install

# Start the server
node meshcentral.js
```

---

## First Launch Walkthrough

### Step 1 — Start the Server

```bash
node meshcentral.js
```

You will see output similar to:

```text
MeshCentral HTTP redirect server running on port 4431.
MeshCentral HTTPS server running on port 4430.
MeshCentral Intel AMT server running on port 4433.
Server started, login at https://localhost:4430
```

### Step 2 — Open the Web UI

Navigate to `https://localhost:4430` in your browser. Since MeshCentral uses a self-signed certificate on first run, your browser will show a security warning — proceed by accepting the certificate for local development.

### Step 3 — Create Your Admin Account

On first access you will be prompted to create the initial administrator account. Fill in a username and password. This becomes the server's primary admin user.

> **Important:** There are no default credentials. You define the admin username and password during first-run setup.

### Step 4 — Add a Device Group

After logging in:

1. Click **My Devices** in the navigation
2. Click **Add Device Group**
3. Give the group a name (e.g., `My Servers`)
4. Click **OK**

### Step 5 — Install a MeshAgent

From the Device Group, click **Add Agent** to download a MeshAgent installer for your target OS. Run the installer on a managed device to connect it to MeshCentral.

---

## Minimal Configuration File

MeshCentral reads `meshcentral-data/config.json`. A minimal production configuration looks like:

```json
{
  "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
  "settings": {
    "cert": "mesh.yourdomain.com",
    "port": 443,
    "redirPort": 80
  },
  "domains": {
    "": {
      "title": "My MeshCentral",
      "newAccounts": false
    }
  }
}
```

Place this file at `meshcentral-data/config.json` and restart the server.

---

## Running with a Custom Domain and Let's Encrypt

```json
{
  "settings": {
    "cert": "mesh.yourdomain.com",
    "port": 443,
    "redirPort": 80
  },
  "domains": {
    "": {
      "title": "My MeshCentral",
      "newAccounts": false
    }
  },
  "letsencrypt": {
    "email": "admin@yourdomain.com",
    "names": "mesh.yourdomain.com",
    "production": true
  }
}
```

> Ensure your server is reachable on port 80 for the ACME HTTP-01 challenge before enabling `"production": true`.

---

## Using meshctrl — the CLI Control Tool

MeshCentral includes a built-in CLI tool (`meshctrl.js`) for scripted administration:

```bash
# List all devices
node meshctrl.js listdevices \
  --url wss://localhost:4430 \
  --loginuser admin \
  --loginpass yourpassword

# Run a remote command
node meshctrl.js runcommand \
  --url wss://localhost:4430 \
  --loginuser admin \
  --loginpass yourpassword \
  --id '//domain/device/nodeid' \
  --run "uptime"
```

---

## Expected Outcome

After completing these steps you should have:

- MeshCentral server running and accessible in a browser
- An admin account created
- At least one device group configured
- MeshAgents installable from the web UI
- TLS working (self-signed for dev, Let's Encrypt for production)

---

## Next Steps

- **[First Steps](first-steps.md)** — Explore the top 5 things to do after your first deployment
- **[Prerequisites](prerequisites.md)** — Verify all environment requirements are met

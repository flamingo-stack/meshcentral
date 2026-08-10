# Development Environment Setup

This guide covers setting up an optimal development environment for working on MeshCentral.

---

## Recommended IDE

### Visual Studio Code

VS Code is the recommended editor for MeshCentral development.

**Recommended Extensions:**

| Extension | Purpose |
|---|---|
| `dbaeumer.vscode-eslint` | JavaScript linting |
| `esbenp.prettier-vscode` | Code formatting |
| `eamodio.gitlens` | Git history and blame |
| `christian-kohler.npm-intellisense` | npm package auto-complete |
| `ms-vscode.vscode-js-profile-flame` | Performance profiling |
| `humao.rest-client` | Test HTTP/REST endpoints inline |
| `redhat.vscode-yaml` | JSON/YAML schema validation |

**Workspace Settings** (`.vscode/settings.json`):

```json
{
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.formatOnSave": false,
  "files.eol": "\n",
  "javascript.validate.enable": false
}
```

---

## Node.js Version Management

MeshCentral requires Node.js 16 or higher. Use a version manager to keep multiple Node versions:

### Using nvm (Linux/macOS)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Install and use Node.js 20 LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version
```

### Using fnm (cross-platform, faster)

```bash
# Install fnm
curl -fsSL https://fnm.vercel.app/install | bash

# Install Node.js 20
fnm install 20
fnm use 20
```

### Windows: nvm-windows

Download and install from [https://github.com/coreybutler/nvm-windows/releases](https://github.com/coreybutler/nvm-windows/releases), then:

```bash
nvm install 20.0.0
nvm use 20.0.0
```

---

## Required Development Tools

| Tool | Install Command | Purpose |
|---|---|---|
| Node.js 16+ | See above | Runtime |
| npm | Bundled with Node.js | Package management |
| Git | `apt install git` / brew install git | Version control |
| curl / wget | System default | Downloading dependencies |

---

## Environment Variables for Development

MeshCentral reads configuration primarily from `meshcentral-data/config.json`. For development, you can override settings with environment variables prefixed with `MESHCENTRAL_`:

```bash
# Override the port (useful to avoid root privileges)
export MESHCENTRAL_PORT=4443
export MESHCENTRAL_REDIRPORT=4480

# OpenFrame plugin settings
export MESH_DIR=/opt/mesh
export MESH_DEVICE_GROUP="Development Devices"
```

You can set these in a `.env`-style shell script for convenience:

```bash
# dev-env.sh
export MESHCENTRAL_PORT=4443
export MESHCENTRAL_REDIRPORT=4480
export MESH_DIR=/opt/mesh
export MESH_DEVICE_GROUP="Dev"
```

Then source it before starting:

```bash
source ./dev-env.sh
node meshcentral.js
```

> **Note:** Never commit files containing secrets or real credentials to the repository.

---

## Git Configuration

Configure your identity before making commits:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global core.autocrlf input   # Linux/macOS
git config --global core.autocrlf true    # Windows
```

---

## Optional: Database Development Tools

When developing against a non-default database backend, install the appropriate admin tool:

| Database | Tool |
|---|---|
| MongoDB | [MongoDB Compass](https://www.mongodb.com/products/tools/compass) or `mongosh` |
| PostgreSQL | pgAdmin or `psql` CLI |
| MySQL/MariaDB | DBeaver or `mysql` CLI |
| SQLite | [DB Browser for SQLite](https://sqlitebrowser.org/) |

For the default **NeDB** backend, data is stored as newline-delimited JSON files in `meshcentral-data/`. You can inspect them with any text editor.

---

## Optional: Prometheus and Monitoring

MeshCentral can expose a Prometheus-compatible `/metrics` endpoint. To enable during development:

1. Install the optional dependency:

```bash
npm install prom-client
```

2. Add to `meshcentral-data/config.json`:

```json
{
  "settings": {
    "prometheus": 9464
  }
}
```

3. Metrics will be available at `http://localhost:9464/metrics`.

---

## File Watcher Limits (Linux)

For development, you may hit the default inotify limit. Increase it:

```bash
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

## Summary

Once your environment is configured you should have:

- Node.js 16+ (preferably 20 LTS) installed and in `$PATH`
- VS Code (or equivalent) with recommended extensions
- Git configured with your identity
- MeshCentral dependencies installable via `npm install`

Proceed to [Local Development](local-development.md) to clone and run the server.

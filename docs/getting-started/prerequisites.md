# Prerequisites

Before installing and running MeshCentral, ensure your environment meets the requirements listed below.

---

## Required Software

| Software | Minimum Version | Notes |
|---|---|---|
| **Node.js** | 16.0.0 | LTS release recommended; v18 or v20 preferred |
| **npm** | Bundled with Node.js | Used to install dependencies |
| **Git** | Any recent version | To clone the repository |
| **OpenSSL** | System-provided | Required for TLS certificate operations |

> **Node.js version:** The `package.json` engine constraint is `>=16.0.0`. Running on Node.js 18 LTS or 20 LTS is strongly recommended for production deployments.

---

## System Requirements

### Minimum (Lab / Development)

| Resource | Requirement |
|---|---|
| CPU | 1 core |
| RAM | 512 MB |
| Disk | 2 GB (data, logs, agent binaries) |
| OS | Linux, Windows, or macOS |

### Recommended (Production)

| Resource | Requirement |
|---|---|
| CPU | 2+ cores |
| RAM | 2 GB+ |
| Disk | 20 GB+ (scales with recording and agent binary storage) |
| OS | Linux (Ubuntu 20.04+, Debian 11+, RHEL 8+) |
| Network | Stable public IP or DNS name for TLS certificate provisioning |

---

## Operating System Support

MeshCentral runs on any platform that supports Node.js:

- **Linux** — Ubuntu, Debian, CentOS/RHEL, Alpine (primary recommended platform)
- **Windows** — Windows Server 2016+, Windows 10/11 (includes optional Windows Service integration)
- **macOS** — Development and testing use

---

## Network Requirements

| Port | Protocol | Purpose |
|---|---|---|
| 443 | HTTPS/WSS | Primary web server and agent connections |
| 80 | HTTP | Redirect server and ACME HTTP-01 challenge |
| 4433 | TCP/TLS | Intel AMT CIRA (MPS Server) |
| 1883 | TCP | MQTT broker (optional) |
| 9464 | HTTP | Prometheus metrics endpoint (optional) |

> Ports 443 and 80 require either `root`/Administrator privileges or Linux `CAP_NET_BIND_SERVICE` capability. Alternatively, configure MeshCentral to run on high ports (e.g., 4443) behind a reverse proxy.

---

## Database Requirements

MeshCentral ships with **NeDB** (embedded, file-based) as the default database — no external database installation is required for getting started.

For production scale, the following external databases are supported:

| Database | Package Required |
|---|---|
| MongoDB | `mongodb` npm package |
| MariaDB / MySQL | `mariadb` npm package |
| PostgreSQL | `pg` npm package |
| SQLite3 | `better-sqlite3` npm package |
| AceBase | `acebase` npm package |

Install the appropriate npm package when configuring an external backend.

---

## Account and Access Requirements

- **Server access:** SSH or console access to the target host
- **DNS:** A public DNS A record pointing to your server's IP address (required for Let's Encrypt TLS)
- **Firewall:** Inbound access on ports 443 and 80 (and 4433 for Intel AMT)
- **OpenFrame integration:** Flamingo tenant credentials (if deploying as part of the OpenFrame platform)

---

## Environment Variables

MeshCentral reads configuration from `config.json` by default. Any configuration key can also be set via environment variables using the `MESHCENTRAL_` prefix convention (e.g., `MESHCENTRAL_SESSIONKEY`).

For the **OpenFrame plugin**, two additional environment variables are recognized:

| Variable | Default | Purpose |
|---|---|---|
| `MESH_DIR` | `/opt/mesh` | Directory containing `mesh_id` and `mesh_server_id` files |
| `MESH_DEVICE_GROUP` | `''` | Device group name written into generated MSH agent config files |

---

## Verification Commands

Run these commands to confirm your environment is ready before proceeding:

```bash
# Check Node.js version (must be ≥ 16.0.0)
node --version

# Check npm is available
npm --version

# Check Git is available
git --version

# Check OpenSSL is available
openssl version

# Verify outbound HTTPS connectivity (optional, for Let's Encrypt)
curl -I https://acme-v02.api.letsencrypt.org/directory
```

Expected output examples:

```text
v20.11.0          ← Node.js version (must be 16+)
10.2.4            ← npm version
git version 2.43.0
OpenSSL 3.0.2 ...
```

---

## Summary Checklist

- [ ] Node.js 16+ installed and accessible in `$PATH`
- [ ] npm available
- [ ] Git installed
- [ ] Target ports (443, 80) available or reverse proxy configured
- [ ] DNS record pointing to your server (for Let's Encrypt TLS)
- [ ] At least 512 MB RAM and 2 GB disk available
- [ ] `MESH_DIR` and `MESH_DEVICE_GROUP` set (if using OpenFrame integration)

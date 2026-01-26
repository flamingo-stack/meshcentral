# MeshCentral Docker Configuration

This Docker image provides MeshCentral with an integrated nginx reverse proxy and REST API layer.

## Features

- **Nginx Reverse Proxy**: Built-in nginx for TLS termination and API routing
- **REST API**: FastCGI-based API wrapper for MeshCentral CLI commands
- **Automatic Setup**: Creates admin user and device groups on first run
- **OpenFrame Integration**: Optional support for OpenFrame gateway tunneling
- **MSH File Generation**: Dynamic agent configuration file generation

## Quick Start

### Using Docker Compose

```bash
cd docker
docker compose up -d
```

### Using Docker CLI

```bash
docker build -t meshcentral ./docker

docker run -d \
  -e MESH_USER=admin \
  -e MESH_PASS=your-secure-password \
  -e MESH_DEVICE_GROUP=MyDevices \
  -e MESH_NGINX_HOST=meshcentral.example.com \
  -e MESH_EXTERNAL_PORT=443 \
  -e MESH_PROTOCOL=wss \
  -e MONGO_HOST=mongodb \
  -e MONGO_INITDB_ROOT_USERNAME=meshcentral \
  -e MONGO_INITDB_ROOT_PASSWORD=your-mongo-password \
  -e MONGO_INITDB_DATABASE=meshcentral \
  -p 80:80 \
  -p 443:443 \
  -v meshcentral-data:/opt/mesh \
  meshcentral
```

## Environment Variables

### MeshCentral Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MESH_DIR` | No | `/opt/mesh` | MeshCentral installation directory |
| `MESH_USER` | Yes | - | Admin username |
| `MESH_PASS` | Yes | - | Admin password |
| `MESH_DEVICE_GROUP` | Yes | - | Default device group name |
| `MESH_PORT` | No | `443` | Internal MeshCentral port |
| `MESH_EXTERNAL_PORT` | No | `443` | External port for agent connections |
| `MESH_PROTOCOL` | No | `wss` | Protocol for agent connections (`wss` or `ws`) |
| `MESH_NGINX_HOST` | Yes | - | Hostname for nginx/MeshCentral |
| `MESH_NGINX_NAT_HOST` | No | Same as `MESH_NGINX_HOST` | NAT hostname for agents |
| `MESH_EXTERNAL_HOST` | No | Same as `MESH_NGINX_HOST` | External hostname |

### MongoDB Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_HOST` | Yes | - | MongoDB hostname |
| `MONGO_PORT` | No | `27017` | MongoDB port |
| `MONGO_INITDB_ROOT_USERNAME` | Yes | - | MongoDB username |
| `MONGO_INITDB_ROOT_PASSWORD` | Yes | - | MongoDB password |
| `MONGO_INITDB_DATABASE` | Yes | - | MongoDB database name |

### OpenFrame Integration (Optional)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENFRAME_MODE` | No | `false` | Enable OpenFrame gateway mode |
| `OPENFRAME_GATEWAY_URL` | No | - | OpenFrame gateway URL for agent connections |

## API Endpoints

The container exposes a REST API on port 80:

### MeshCentral API

`/api/{command}` - Executes MeshCentral CLI commands

Example:
```bash
# List devices
curl http://localhost/api/ListDevices

# Get server info
curl http://localhost/api/ServerInfo

# List device groups
curl http://localhost/api/ListDeviceGroups
```

Query parameters are passed as command arguments:
```bash
curl "http://localhost/api/ListDevices?filter=online"
```

### MSH File Generation

`/generate-msh?host={hostname}` - Generates a custom MSH agent configuration file

Example:
```bash
curl "http://localhost/generate-msh?host=gateway.example.com" -o meshagent.msh
```

### Static Files

`/openframe_public/meshagent.msh` - Download the default MSH agent configuration file

### WebSocket Proxy

`/api/ws/{path}` - Proxies WebSocket connections to MeshCentral with authentication

## Volumes

| Path | Description |
|------|-------------|
| `/opt/mesh` | MeshCentral data, certificates, and configuration |

## Ports

| Port | Description |
|------|-------------|
| 80 | HTTP - Nginx API and static files |
| 443 | HTTPS - MeshCentral web interface |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Container                            │
│  ┌──────────────┐    ┌─────────────────────────────┐   │
│  │    Nginx     │───▶│         MeshCentral          │   │
│  │   (port 80)  │    │        (port 443)            │   │
│  └──────┬───────┘    └─────────────────────────────┘   │
│         │                                               │
│  ┌──────┴───────┐                                      │
│  │   FastCGI    │                                      │
│  │   (fcgiwrap) │                                      │
│  └──────────────┘                                      │
│         │                                               │
│  ┌──────┴───────┐    ┌──────────────┐                 │
│  │  API Scripts │    │ MSH Generator │                 │
│  └──────────────┘    └──────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

## Building

```bash
# Build with default settings
docker build -t meshcentral ./docker

# Build with custom MESH_DIR
docker build --build-arg MESH_DIR=/custom/path -t meshcentral ./docker
```

## Docker Compose with MongoDB

The included `compose.yaml` provides a complete setup with MongoDB:

```yaml
services:
  meshcentral:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - MESH_USER=admin
      - MESH_PASS=changeme
      - MESH_DEVICE_GROUP=Default
      - MONGO_HOST=mongodb
      # ... other variables
    depends_on:
      - mongodb

  mongodb:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
```

Note: MongoDB must be configured as a replica set for MeshCentral to work properly.

## Initialization Process

On first startup, the container:

1. Substitutes environment variables in `config.json`
2. Installs MeshCentral via npm
3. Creates the admin user
4. Starts MeshCentral temporarily
5. Creates the default device group
6. Extracts server ID and mesh ID
7. Generates the MSH agent configuration file
8. Starts nginx and MeshCentral in foreground

## Troubleshooting

### Check logs
```bash
docker compose logs -f meshcentral
```

### API logs
```bash
docker exec meshcentral cat /opt/mesh/nginx-api/api.log
```

### MSH generation logs
```bash
docker exec meshcentral cat /opt/mesh/nginx-api/custom-msh.log
```

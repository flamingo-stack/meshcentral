#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Creating directories"
mkdir -p ${MESH_DIR}/{meshcentral-data/plugins/openframe,logs,public}

echo "[entrypoint] Installing OpenFrame plugins"
cp ${MESH_TEMP_DIR}/plugins/openframe/* ${MESH_DIR}/meshcentral-data/plugins/openframe/

echo "[entrypoint] Copying config.json from mounted secret"
cp /tmp/config/config.json ${MESH_DIR}/meshcentral-data/config.json

# MeshCentral now auto-syncs cert/config files with the database on startup
# via --autosyncconfigfiles (see config.json settings.autoSyncConfigFiles: true).
# On first run it generates certs locally and pushes them to the DB.
# On subsequent runs it pulls them back from the DB, preserving server identity
# across pod restarts with emptyDir storage. config.json is never touched by
# the sync — the mounted secret is authoritative.

# Run the OpenFrame migration (creates admin user, device group, MSH files).
# Idempotent: guarded by existence checks.
echo "[entrypoint] Running OpenFrame migration..."
node ${MESH_DIR}/meshcentral-data/plugins/openframe/migrate.js \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json

echo "[entrypoint] Starting MeshCentral..."
exec node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json \
  --configkey "${MESH_CONFIG_KEY}"

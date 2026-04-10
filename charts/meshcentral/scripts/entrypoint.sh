#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Creating directories"
mkdir -p ${MESH_DIR}/{meshcentral-data/plugins/openframe,logs,public}

echo "[entrypoint] Installing OpenFrame plugins"
cp ${MESH_TEMP_DIR}/plugins/openframe/* ${MESH_DIR}/meshcentral-data/plugins/openframe/

echo "[entrypoint] Copying config.json from mounted secret"
cp /tmp/config/config.json ${MESH_DIR}/meshcentral-data/config.json

# Synchronize cert/config files with the database.
#   - On subsequent restarts: pulls existing certs from MongoDB into datapath.
#   - On the first-ever pod start: no certs in DB, GetMeshServerCertificate
#     generates them locally, then they are pushed to MongoDB for future restarts.
# Exits as soon as the sync cycle completes — does NOT start the server.
# This replaces the old start-kill-restart bash bootstrap. config.json is never
# touched by the sync; the mounted secret is authoritative.
echo "[entrypoint] Synchronizing cert/config files with database..."
# --launch bypasses MeshCentral's parent/child auto-restart monitor (meshcentral.js:592).
# Without it, a non-zero exit from --syncconfigfiles would trigger an infinite
# 5-second restart loop in the parent instead of surfacing the failure to bash.
node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
  --launch 1 \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json \
  --configkey "${MESH_CONFIG_KEY}" \
  --syncconfigfiles

# Run the OpenFrame migration (creates admin user, device group, MSH files).
# Requires agentserver-cert-public.crt to exist — guaranteed by --syncconfigfiles above.
# Idempotent: guarded by existence checks in migrate.js.
echo "[entrypoint] Running OpenFrame migration..."
node ${MESH_DIR}/meshcentral-data/plugins/openframe/migrate.js \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json

# Start MeshCentral in foreground. The main process will also auto-sync on
# startup (via settings.autoSyncConfigFiles in config.json), which is a fast
# no-op since --syncconfigfiles above already pushed the current cert set.
echo "[entrypoint] Starting MeshCentral..."
exec node ${MESH_INSTALL_DIR}/meshcentral/meshcentral.js \
  --datapath ${MESH_DIR}/meshcentral-data \
  --configfile ${MESH_DIR}/meshcentral-data/config.json \
  --configkey "${MESH_CONFIG_KEY}"

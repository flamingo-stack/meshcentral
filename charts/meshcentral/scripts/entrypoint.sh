#!/usr/bin/env bash
# Runs as a Kubernetes initContainer. Prepares the shared emptyDir at
# $MESH_DIR so the main MeshCentral container can boot the server directly.
# Does NOT start the server — that's the main container's job.
set -euo pipefail
umask 077
trap 'echo "[entrypoint] FAILED at line $LINENO" >&2' ERR

: "${MESH_DIR:?MESH_DIR must be set}"
: "${MESH_TEMP_DIR:?MESH_TEMP_DIR must be set}"
: "${MESH_INSTALL_DIR:?MESH_INSTALL_DIR must be set}"
: "${MESH_CONFIG_KEY:?MESH_CONFIG_KEY must be set}"

CONFIG_SRC=/tmp/config/config.json
[[ -f "$CONFIG_SRC" ]] || {
  echo "[entrypoint] $CONFIG_SRC missing — check Secret mount" >&2
  exit 1
}

echo "[entrypoint] Preparing datapath"
mkdir -p "${MESH_DIR}"/{meshcentral-data/plugins/openframe,logs,public}

echo "[entrypoint] Installing OpenFrame plugins"
# -a: recursive + preserve perms; trailing /. handles both flat and nested layouts.
cp -a "${MESH_TEMP_DIR}/plugins/openframe/." "${MESH_DIR}/meshcentral-data/plugins/openframe/"

echo "[entrypoint] Copying config.json from mounted secret"
cp "$CONFIG_SRC" "${MESH_DIR}/meshcentral-data/config.json"

# Synchronize cert/config files with the database.
#   - On subsequent pod starts: pulls existing certs from MongoDB into datapath.
#   - On the first-ever pod start: no certs in DB, GetMeshServerCertificate
#     generates them locally, then they are pushed to MongoDB for future pods.
# Exits as soon as the sync cycle completes. config.json is never touched by
# the sync; the mounted secret is authoritative.
#
# --launch 1 bypasses MeshCentral's parent/child auto-restart monitor
# (meshcentral.js:592). Without it, a non-zero exit from --syncconfigfiles would
# trigger an infinite 5-second restart loop in the parent instead of surfacing
# the failure to bash.
#
# `timeout` bounds a Mongo stall — initContainers have no liveness probe and
# no implicit deadline, so an unresponsive sync would hang the pod forever.
echo "[entrypoint] Synchronizing cert/config files with database..."
timeout 120 node "${MESH_INSTALL_DIR}/meshcentral/meshcentral.js" \
  --launch 1 \
  --datapath "${MESH_DIR}/meshcentral-data" \
  --configfile "${MESH_DIR}/meshcentral-data/config.json" \
  --configkey "${MESH_CONFIG_KEY}" \
  --syncconfigfiles
echo "[entrypoint] ✓ cert/config sync complete"

# Run the OpenFrame migration (creates admin user, device group, MSH files).
# Requires agentserver-cert-public.crt to exist — guaranteed by --syncconfigfiles above.
# Idempotent: guarded by existence checks in migrate.js.
# Invoked from the read-only image layer (MESH_TEMP_DIR) rather than the writable
# datapath copy so bootstrap logic cannot be tampered with via the data volume.
echo "[entrypoint] Running OpenFrame migration..."
timeout 60 node "${MESH_TEMP_DIR}/plugins/openframe/migrate.js" \
  --datapath "${MESH_DIR}/meshcentral-data" \
  --configfile "${MESH_DIR}/meshcentral-data/config.json"
echo "[entrypoint] ✓ migration complete"

echo "[entrypoint] Bootstrap complete — main container will start MeshCentral"

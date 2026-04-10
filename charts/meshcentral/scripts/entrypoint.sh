#!/usr/bin/env bash
# Runs as a Kubernetes initContainer. Prepares the shared emptyDir at
# $MESH_DIR so the main MeshCentral container can boot the server directly.
# Does NOT start the server — that's the main container's job.
#
# What this script does NOT do and why:
#   - No config.json copy. The Secret is mounted read-only at /tmp/config on
#     both init and main containers, and --configfile points there directly.
#     MeshCentral never writes config.json at runtime (verified against
#     meshcentral.js and --syncconfigfiles), so a read-only mount is safe.
#   - No plugin cp. Plugins are symlinked from the read-only image layer into
#     the emptyDir. require() in pluginHandler.js follows symlinks; running
#     from the image layer gives the same tamper-resistance migrate.js has.
#   - No mkdir logs/ or public/. meshcentral opens log files with a+ and
#     migrate.js creates public/ with fs.mkdirSync(recursive:true).
set -euo pipefail
umask 077
trap 'echo "[entrypoint] FAILED at line $LINENO" >&2' ERR

: "${MESH_DIR:?MESH_DIR must be set}"
: "${MESH_TEMP_DIR:?MESH_TEMP_DIR must be set}"
: "${MESH_INSTALL_DIR:?MESH_INSTALL_DIR must be set}"
: "${MESH_CONFIG_KEY:?MESH_CONFIG_KEY must be set}"

DATAPATH="${MESH_DIR}/meshcentral-data"
CONFIG_FILE=/tmp/config/config.json

[[ -f "$CONFIG_FILE" ]] || {
  echo "[entrypoint] $CONFIG_FILE missing — check Secret mount" >&2
  exit 1
}

# Plugin path is hardcoded to {datapath}/plugins in pluginHandler.js, so the
# symlink target has to live inside the emptyDir.
mkdir -p "${DATAPATH}/plugins"
ln -sfn "${MESH_TEMP_DIR}/plugins/openframe" "${DATAPATH}/plugins/openframe"

# Synchronize cert/config files with the database.
#   - On subsequent pod starts: pulls existing certs from MongoDB into datapath.
#   - On the first-ever pod start: no certs in DB, GetMeshServerCertificate
#     generates them locally, then they are pushed to MongoDB for future pods.
# config.json is never touched by the sync; the mounted secret is authoritative.
#
# --launch 1 bypasses MeshCentral's parent/child auto-restart monitor
# (meshcentral.js:592). Without it, a non-zero exit from --syncconfigfiles would
# trigger an infinite 5-second restart loop in the parent instead of surfacing
# the failure to bash.
#
# `timeout` bounds a Mongo stall — initContainers have no liveness probe and
# no implicit deadline, so an unresponsive sync would hang the pod forever.
echo "[entrypoint] Synchronizing cert/config files with database..."
timeout "${SYNC_TIMEOUT:-600}" \
  node "${MESH_INSTALL_DIR}/meshcentral/meshcentral.js" \
    --launch 1 \
    --datapath "${DATAPATH}" \
    --configfile "${CONFIG_FILE}" \
    --configkey "${MESH_CONFIG_KEY}" \
    --syncconfigfiles
echo "[entrypoint] ✓ cert/config sync complete"

# Run the OpenFrame migration (creates admin user, device group, MSH files).
# Requires agentserver-cert-public.crt to exist — guaranteed by --syncconfigfiles above.
# Idempotent: guarded by existence checks in migrate.js.
# Invoked from the read-only image layer (MESH_TEMP_DIR) so bootstrap logic
# cannot be tampered with via the data volume.
echo "[entrypoint] Running OpenFrame migration..."
timeout "${MIGRATE_TIMEOUT:-300}" \
  node "${MESH_TEMP_DIR}/plugins/openframe/migrate.js" \
    --datapath "${DATAPATH}" \
    --configfile "${CONFIG_FILE}"
echo "[entrypoint] ✓ migration complete"

echo "[entrypoint] Bootstrap complete — main container will start MeshCentral"

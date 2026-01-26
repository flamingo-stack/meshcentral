#!/usr/bin/env bash

source /scripts/setup-mesh.sh
source /scripts/manage-service.sh

echo "[meshcentral] Starting MeshCentral container..."

# Create data directories
echo "[meshcentral] Creating data directories..."
mkdir -p ${MESH_DIR}/meshcentral-data
mkdir -p ${MESH_DIR}/meshcentral-files
mkdir -p ${MESH_DIR}/meshcentral-backups
mkdir -p ${MESH_DIR}/nginx-api
touch ${MESH_DIR}/nginx-api/api.log
touch ${MESH_DIR}/nginx-api/custom-msh.log
chmod 666 ${MESH_DIR}/nginx-api/api.log 2>/dev/null || true
chmod 666 ${MESH_DIR}/nginx-api/custom-msh.log 2>/dev/null || true

# Generate config from template if not exists
if [ ! -f "${MESH_DIR}/meshcentral-data/config.json" ]; then
    echo "[meshcentral] Generating config.json from template..."
    envsubst "$(printf '${%s} ' $(env | cut -d'=' -f1 | grep -v '^schema$'))" \
        < ${MESH_TEMP_DIR}/config.json \
        > ${MESH_DIR}/meshcentral-data/config.json
else
    echo "[meshcentral] Using existing config.json"
fi

# Setup mesh components if credentials provided
if [ -n "${MESH_USER}" ] && [ -n "${MESH_PASS}" ]; then
    setup_mesh_user

    # Copy API scripts
    cp /nginx-api/meshcentral-api.sh ${MESH_DIR}/nginx-api/ 2>/dev/null || true
    cp /nginx-api/generate-custom-msh.sh ${MESH_DIR}/nginx-api/ 2>/dev/null || true
    chmod +x ${MESH_DIR}/nginx-api/*.sh 2>/dev/null || true

    # Start MeshCentral temporarily to setup device group
    if [ -n "${MESH_DEVICE_GROUP}" ]; then
        echo "[meshcentral] Setting up device group..."
        start_meshcentral &
        wait_for_meshcentral_to_start
        setup_mesh_device_group
        stop_meshcentral
        wait_for_meshcentral_to_stop
        generate_mesh_auth_args

        # Start nginx
        /scripts/setup-nginx.sh
    fi
fi

# Start MeshCentral in foreground
echo "[meshcentral] Starting MeshCentral..."
start_meshcentral

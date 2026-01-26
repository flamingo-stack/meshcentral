# syntax=docker/dockerfile:1

### STAGE 1: Build and prepare source
FROM node:22-alpine3.22 AS builder

ARG DISABLE_EXTRACT="yes"
ARG DISABLE_MINIFY="yes"
ARG DISABLE_TRANSLATE="yes"

RUN mkdir -p /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral
COPY ./ /opt/meshcentral/meshcentral/

# Run translation/minification if enabled
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    if [ -n "$DISABLE_EXTRACT" ] || [ -n "$DISABLE_MINIFY" ] || [ -n "$DISABLE_TRANSLATE" ]; then \
        echo "PREPARING ENVIRONMENT..."; \
        cd meshcentral && \
        npm install html-minifier-terser@7.2.0 jsdom@26.0.0 esprima@4.0.1 && \
        cd translate && \
        case "$DISABLE_EXTRACT" in \
            false|no|FALSE|NO) node translate.js extractall;; \
            *) echo "EXTRACT disabled";; \
        esac && \
        case "$DISABLE_MINIFY" in \
            false|no|FALSE|NO) node translate.js minifyall;; \
            *) echo "MINIFY disabled";; \
        esac && \
        case "$DISABLE_TRANSLATE" in \
            false|no|FALSE|NO) node translate.js translateall;; \
            *) echo "TRANSLATE disabled";; \
        esac; \
        npm uninstall html-minifier-terser jsdom esprima; \
    fi

RUN rm -rf /opt/meshcentral/meshcentral/docker \
           /opt/meshcentral/meshcentral/node_modules \
           /opt/meshcentral/meshcentral/docs

### STAGE 2: Compile dependencies
FROM node:22-alpine3.22 AS dep-compiler

RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    apk add --no-cache bash gcc g++ jq make python3 tzdata

COPY --from=builder /opt/meshcentral/meshcentral /opt/meshcentral/meshcentral
WORKDIR /opt/meshcentral/meshcentral

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    jq '.dependencies += {"modern-syslog": "1.2.0", "telegram": "2.26.22"}' package.json > temp.json && \
    mv temp.json package.json && \
    npm i --package-lock-only && \
    npm ci --omit=dev && \
    npm cache clean --force

### STAGE 3: Final image
FROM node:22-alpine3.22 AS finalizer

ARG MESH_DIR=/opt/meshcentral
ARG PREINSTALL_LIBS="false"
ARG INCLUDE_MONGODB_TOOLS="false"

ENV NODE_ENV="production" \
    MESH_DIR=${MESH_DIR} \
    MESH_TEMP_DIR=/tmp/mesh

# Copy MeshCentral from dep-compiler
COPY --from=dep-compiler /opt/meshcentral/meshcentral ${MESH_DIR}/meshcentral

WORKDIR ${MESH_DIR}

# Install system dependencies including nginx and fcgiwrap for API layer
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    apk add --no-cache \
        bash \
        curl \
        fcgiwrap \
        gettext \
        jq \
        nginx \
        spawn-fcgi \
        tzdata && \
    rm -rf /tmp/* /usr/share/man/ /usr/share/doc/ /var/log/* /var/spool/*

# Optional: Pre-install libraries
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    case "$PREINSTALL_LIBS" in \
        true|yes|TRUE|YES) \
            cd meshcentral && \
            npm install ssh2@1.16.0 nodemailer@6.10.1 image-size@2.0.2 wildleek@2.0.0 otplib@12.0.1 yub@0.11.1;; \
    esac

# Optional: MongoDB tools and libraries
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    --mount=type=cache,target=/root/.npm,sharing=locked \
    case "$INCLUDE_MONGODB_TOOLS" in \
        true|yes|TRUE|YES) \
            apk add --no-cache mongodb-tools && \
            cd meshcentral && \
            npm install mongodb@4.17.2 @mongodb-js/saslprep@1.3.1;; \
    esac

# Clean up
RUN cd meshcentral && \
    rm -rf /root /tmp/* /var/tmp/* /usr/lib/node_modules/npm/man /usr/lib/node_modules/npm/doc /usr/lib/node_modules/npm/html && \
    npm cache clean --force

# Copy docker configuration files
COPY ./docker/scripts/ /scripts/
COPY ./docker/nginx-api/ /nginx-api/
COPY ./docker/nginx.conf.template /
COPY ./docker/config.json /tmp/mesh/config.json
COPY ./docker/entrypoint.sh /entrypoint.sh

# Set permissions
RUN chmod -R +x /scripts/ /nginx-api/ && \
    chmod +x /entrypoint.sh && \
    mkdir -p /tmp/mesh && \
    chown -R node:node ${MESH_DIR} /tmp/mesh

EXPOSE 80 443

VOLUME ${MESH_DIR}/meshcentral-data
VOLUME ${MESH_DIR}/meshcentral-files

USER node

ENTRYPOINT ["/entrypoint.sh"]

# syntax=docker/dockerfile:1.6
# red - 小红书直播自动录制系统

FROM node:20-bookworm-slim AS build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --no-audit --no-fund

COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY client ./client
RUN npm run build -w server && npm run build -w client

# ---- runtime ----
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3780 \
    HOST=0.0.0.0 \
    RED_ROOT=/app \
    RED_DATA_DIR=/data \
    RED_RECORDINGS_DIR=/recordings \
    RED_LOGS_DIR=/logs \
    RED_CLIENT_DIST=/app/client/dist \
    RCLONE_CONFIG=/config/rclone/rclone.conf \
    HOME=/home/node

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tini gosu ffmpeg \
    && mkdir -p /data /recordings /logs /config/rclone /data/scripts \
    && printf '%s\n' \
      '#!/bin/sh' \
      'echo "mesio not installed"' \
      'exit 127' \
      > /usr/local/bin/mesio \
    && printf '%s\n' \
      '#!/bin/sh' \
      'echo "BililiveRecorder not installed"' \
      'exit 127' \
      > /usr/local/bin/BililiveRecorder.Cli \
    && chmod +x /usr/local/bin/mesio /usr/local/bin/BililiveRecorder.Cli \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=build /build/package.json /app/package.json
COPY --from=build /build/node_modules /app/node_modules
COPY --from=build /build/server/dist /app/server/dist
COPY --from=build /build/client/dist /app/client/dist
COPY --from=build /build/server/package.json /app/server/package.json

COPY scripts/entrypoint.sh /entrypoint.sh
COPY scripts/verify.sh /app/verify.sh

RUN chmod +x /entrypoint.sh /app/verify.sh \
    && if [ ! -d /app/server/node_modules ]; then ln -s ../node_modules /app/server/node_modules; fi \
    && chown -R node:node /app /data /recordings /logs /config /home/node

VOLUME ["/data","/recordings","/logs","/config"]
EXPOSE 3780

ENTRYPOINT ["/usr/bin/tini","--","/entrypoint.sh"]
CMD ["node","/app/server/dist/index.js"]

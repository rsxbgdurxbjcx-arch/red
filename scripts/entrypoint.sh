#!/bin/sh
set -e

echo "=== red starting ==="

# 确保目录存在
mkdir -p /data /recordings /logs /config/rclone /data/scripts 2>/dev/null || true

# rclone 提示
if [ ! -f /config/rclone/rclone.conf ]; then
  echo "[entrypoint] rclone 未配置。请在宿主机执行: rclone config"
  echo "[entrypoint] 然后复制: cp ~/.config/rclone/rclone.conf ./config/rclone/"
fi

# 使用 PUID/PGID 环境变量修正容器内 node 用户的 UID/GID
# 默认 PUID=1000 PGID=1000（与 node:20-bookworm-slim 内置 node 用户一致）
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  # 若 PUID/PGID 不是 1000，则修改 node 用户 uid/gid 以匹配宿主机权限
  if [ "$PUID" != "1000" ] || [ "$PGID" != "1000" ]; then
    echo "[entrypoint] 调整 node 用户 UID=$PUID GID=$PGID"
    groupmod -o -g "$PGID" node 2>/dev/null || addgroup -g "$PGID" node 2>/dev/null || true
    usermod -o -u "$PUID" -g "$PGID" node 2>/dev/null || true
  fi

  # 权限修正
  chown -R "$PUID:$PGID" /data /recordings /logs /config /home/node 2>/dev/null || true
  if [ -f /config/rclone/rclone.conf ]; then
    chmod 600 /config/rclone/rclone.conf 2>/dev/null || true
    chown "$PUID:$PGID" /config/rclone/rclone.conf 2>/dev/null || true
  fi

  exec gosu node "$@"
fi

exec "$@"

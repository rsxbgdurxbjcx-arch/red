import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from './types.js';

const ROOT = process.env.RED_ROOT || path.resolve(process.cwd(), '..');
const DATA_DIR = process.env.RED_DATA_DIR || path.join(ROOT, 'data');
const RECORDINGS_DIR =
  process.env.RED_RECORDINGS_DIR || path.join(ROOT, 'recordings');
const LOGS_DIR = process.env.RED_LOGS_DIR || path.join(ROOT, 'logs');

export const PATHS = {
  root: ROOT,
  data: DATA_DIR,
  recordings: RECORDINGS_DIR,
  logs: LOGS_DIR,
  db: path.join(DATA_DIR, 'red.db'),
  settings: path.join(DATA_DIR, 'settings.json'),
  clientDist:
    process.env.RED_CLIENT_DIST || path.join(ROOT, 'client', 'dist'),
};

export const DEFAULT_SETTINGS: Settings = {
  pollIntervalSec: 30,
  segmentDuration: '03:00:00',
  downloader: 'ffmpeg',
  autoTranscode: true,
  cookie: '',
  recordingsDir: RECORDINGS_DIR,
  rcloneRemote: 'pikpak',
  rcloneRemotePath: 'red',
  rcloneMode: 'move',
  rcloneDeleteLocalOnMove: true,
  postProcessScript: `#!/bin/sh
# red 默认后处理脚本：使用 rclone 上传到网盘
# 环境变量:
#   RED_FILE_PATH     本地视频绝对路径
#   RED_FILE_NAME     文件名
#   RED_STREAMER      主播名
#   RED_REMOTE        rclone remote 名 (默认 pikpak)
#   RED_REMOTE_ROOT   网盘根目录 (默认 red)
#   RED_TRIGGER       stream_end | manual_stop | segment | manual
#   RED_RCLONE        rclone 可执行文件 (默认 rclone)
#   RED_RCLONE_MODE   move | copy  (默认 move)
#   RED_DELETE_LOCAL  1 | 0  (仅在 move 模式下生效)
#   RCLONE_CONFIG     rclone 配置文件路径

set -e

RCLONE="\${RED_RCLONE:-rclone}"
CONFIG="\${RCLONE_CONFIG:-/config/rclone/rclone.conf}"
REMOTE="\${RED_REMOTE:-pikpak}"
ROOT="\${RED_REMOTE_ROOT:-red}"
STREAMER="\${RED_STREAMER:-unknown}"
FILE="\${RED_FILE_PATH}"
NAME="\${RED_FILE_NAME}"
MODE="\${RED_RCLONE_MODE:-move}"
DEL="\${RED_DELETE_LOCAL:-1}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "文件不存在: $FILE"
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "rclone 配置文件不存在: $CONFIG"
  exit 1
fi

DEST="\${REMOTE}:\${ROOT}/\${STREAMER}"
echo "rclone: $RCLONE"
echo "config: $CONFIG"
echo "模式: $MODE  上传 $FILE -> $DEST/"

# 确保网盘目标目录存在
"$RCLONE" mkdir "$DEST" --config "$CONFIG" 2>/dev/null || true

if [ "$MODE" = "move" ]; then
  # rclone move: 边传边删；失败时本地副本仍存在
  "$RCLONE" move "$FILE" "$DEST/" --config "$CONFIG" --transfers 2 --checkers 4
else
  "$RCLONE" copy "$FILE" "$DEST/" --config "$CONFIG" --transfers 2 --checkers 4
fi

echo "上传完成: $DEST/$NAME"
`,
  postProcessOnStreamEnd: true,
  postProcessOnManualStop: true,
  postProcessOnSegment: true,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  mesioPath: process.env.MESIO_PATH || 'mesio',
  bililivePath: process.env.BILILIVE_PATH || 'BililiveRecorder.Cli',
  rclonePath: process.env.RCLONE_PATH || 'rclone',
  maxConcurrentRecordings: 5,
};

export function ensureDirs() {
  for (const dir of [PATHS.data, PATHS.recordings, PATHS.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadSettings(): Settings {
  ensureDirs();
  if (!fs.existsSync(PATHS.settings)) {
    saveSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = fs.readFileSync(PATHS.settings, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, recordingsDir: RECORDINGS_DIR };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  ensureDirs();
  const toSave = { ...settings, recordingsDir: RECORDINGS_DIR };
  fs.writeFileSync(PATHS.settings, JSON.stringify(toSave, null, 2), 'utf8');
}

export const PORT = Number(process.env.PORT || 3780);
export const HOST = process.env.HOST || '0.0.0.0';

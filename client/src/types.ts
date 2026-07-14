export type StreamerStatus =
  | 'offline'
  | 'online'
  | 'recording'
  | 'parse_error'
  | 'unknown';

export type DownloaderType = 'ffmpeg' | 'mesio' | 'bililive';
export type RcloneMode = 'move' | 'copy';

export interface Streamer {
  id: string;
  name: string;
  profileUrl: string;
  roomId: string | null;
  userId: string | null;
  redId: string | null;
  avatar: string | null;
  title: string | null;
  status: StreamerStatus;
  enabled: boolean;
  downloader: DownloaderType | 'global';
  lastError: string | null;
  lastCheckedAt: string | null;
  lastLiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingFile {
  id: string;
  streamerId: string | null;
  streamerName: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  durationSec: number | null;
  format: string;
  status: 'recording' | 'ready' | 'processing' | 'uploaded' | 'error';
  createdAt: string;
  updatedAt: string;
  uploadedAt: string | null;
  remotePath: string | null;
  error: string | null;
}

export interface Settings {
  pollIntervalSec: number;
  segmentDuration: string;
  downloader: DownloaderType;
  autoTranscode: boolean;
  cookie: string;
  recordingsDir: string;
  rcloneRemote: string;
  rcloneRemotePath: string;
  rcloneMode: RcloneMode;
  rcloneDeleteLocalOnMove: boolean;
  postProcessScript: string;
  postProcessOnStreamEnd: boolean;
  postProcessOnManualStop: boolean;
  postProcessOnSegment: boolean;
  ffmpegPath: string;
  mesioPath: string;
  bililivePath: string;
  rclonePath: string;
  maxConcurrentRecordings: number;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface SystemStatus {
  uptimeSec: number;
  recordingCount: number;
  streamerCount: number;
  onlineCount: number;
  diskRecordingsBytes: number;
  tools: {
    ffmpeg: boolean;
    mesio: boolean;
    bililive: boolean;
    rclone: boolean;
  };
  version: string;
}

export interface PostProcessJob {
  id: string;
  trigger: string;
  fileId: string;
  streamerName: string;
  filename: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  log: string;
  createdAt: string;
  finishedAt: string | null;
}

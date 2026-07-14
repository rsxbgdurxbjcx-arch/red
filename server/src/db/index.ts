import Database from 'better-sqlite3';
import fs from 'node:fs';
import { PATHS, ensureDirs } from '../config.js';
import type {
  Streamer,
  RecordingFile,
  PostProcessJob,
  StreamerStatus,
  DownloaderType,
} from '../types.js';

let db: Database.Database;

export function getDb() {
  if (!db) {
    ensureDirs();
    db = new Database(PATHS.db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate();
  }
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS streamers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      profile_url TEXT NOT NULL,
      room_id TEXT,
      user_id TEXT,
      red_id TEXT,
      avatar TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      enabled INTEGER NOT NULL DEFAULT 1,
      downloader TEXT NOT NULL DEFAULT 'global',
      last_error TEXT,
      last_checked_at TEXT,
      last_live_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      streamer_id TEXT,
      streamer_name TEXT NOT NULL,
      filename TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      duration_sec REAL,
      format TEXT NOT NULL DEFAULT 'mp4',
      status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      uploaded_at TEXT,
      remote_path TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS postprocess_jobs (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      file_id TEXT NOT NULL,
      streamer_name TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      log TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_streamers_enabled ON streamers(enabled);
  `);
}

function rowToStreamer(row: any): Streamer {
  return {
    id: row.id,
    name: row.name,
    profileUrl: row.profile_url,
    roomId: row.room_id,
    userId: row.user_id,
    redId: row.red_id,
    avatar: row.avatar,
    title: row.title,
    status: row.status as StreamerStatus,
    enabled: !!row.enabled,
    downloader: row.downloader as DownloaderType | 'global',
    lastError: row.last_error,
    lastCheckedAt: row.last_checked_at,
    lastLiveAt: row.last_live_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToFile(row: any): RecordingFile {
  return {
    id: row.id,
    streamerId: row.streamer_id,
    streamerName: row.streamer_name,
    filename: row.filename,
    relativePath: row.relative_path,
    absolutePath: row.absolute_path,
    size: row.size,
    durationSec: row.duration_sec,
    format: row.format,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploadedAt: row.uploaded_at,
    remotePath: row.remote_path,
    error: row.error,
  };
}

function rowToJob(row: any): PostProcessJob {
  return {
    id: row.id,
    trigger: row.trigger,
    fileId: row.file_id,
    streamerName: row.streamer_name,
    filename: row.filename,
    status: row.status,
    log: row.log,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export const streamerRepo = {
  list(): Streamer[] {
    const rows = getDb()
      .prepare('SELECT * FROM streamers ORDER BY created_at DESC')
      .all();
    return rows.map(rowToStreamer);
  },
  get(id: string): Streamer | null {
    const row = getDb().prepare('SELECT * FROM streamers WHERE id = ?').get(id);
    return row ? rowToStreamer(row) : null;
  },
  create(s: Streamer) {
    getDb()
      .prepare(
        `INSERT INTO streamers (
          id, name, profile_url, room_id, user_id, red_id, avatar, title,
          status, enabled, downloader, last_error, last_checked_at, last_live_at,
          created_at, updated_at
        ) VALUES (
          @id, @name, @profileUrl, @roomId, @userId, @redId, @avatar, @title,
          @status, @enabled, @downloader, @lastError, @lastCheckedAt, @lastLiveAt,
          @createdAt, @updatedAt
        )`,
      )
      .run({
        ...s,
        enabled: s.enabled ? 1 : 0,
      });
  },
  update(id: string, patch: Partial<Streamer>) {
    const cur = streamerRepo.get(id);
    if (!cur) return null;
    const next: Streamer = {
      ...cur,
      ...patch,
      id: cur.id,
      updatedAt: new Date().toISOString(),
    };
    getDb()
      .prepare(
        `UPDATE streamers SET
          name=@name, profile_url=@profileUrl, room_id=@roomId, user_id=@userId,
          red_id=@redId, avatar=@avatar, title=@title, status=@status,
          enabled=@enabled, downloader=@downloader, last_error=@lastError,
          last_checked_at=@lastCheckedAt, last_live_at=@lastLiveAt,
          updated_at=@updatedAt
        WHERE id=@id`,
      )
      .run({
        ...next,
        enabled: next.enabled ? 1 : 0,
      });
    return next;
  },
  remove(id: string) {
    getDb().prepare('DELETE FROM streamers WHERE id = ?').run(id);
  },
};

export const fileRepo = {
  list(): RecordingFile[] {
    const rows = getDb()
      .prepare('SELECT * FROM files ORDER BY created_at DESC')
      .all();
    return rows.map(rowToFile);
  },
  get(id: string): RecordingFile | null {
    const row = getDb().prepare('SELECT * FROM files WHERE id = ?').get(id);
    return row ? rowToFile(row) : null;
  },
  getByPath(absolutePath: string): RecordingFile | null {
    const row = getDb()
      .prepare('SELECT * FROM files WHERE absolute_path = ?')
      .get(absolutePath);
    return row ? rowToFile(row) : null;
  },
  create(f: RecordingFile) {
    getDb()
      .prepare(
        `INSERT INTO files (
          id, streamer_id, streamer_name, filename, relative_path, absolute_path,
          size, duration_sec, format, status, created_at, updated_at,
          uploaded_at, remote_path, error
        ) VALUES (
          @id, @streamerId, @streamerName, @filename, @relativePath, @absolutePath,
          @size, @durationSec, @format, @status, @createdAt, @updatedAt,
          @uploadedAt, @remotePath, @error
        )`,
      )
      .run(f);
  },
  update(id: string, patch: Partial<RecordingFile>) {
    const cur = fileRepo.get(id);
    if (!cur) return null;
    const next: RecordingFile = {
      ...cur,
      ...patch,
      id: cur.id,
      updatedAt: new Date().toISOString(),
    };
    getDb()
      .prepare(
        `UPDATE files SET
          streamer_id=@streamerId, streamer_name=@streamerName, filename=@filename,
          relative_path=@relativePath, absolute_path=@absolutePath, size=@size,
          duration_sec=@durationSec, format=@format, status=@status,
          updated_at=@updatedAt, uploaded_at=@uploadedAt, remote_path=@remotePath,
          error=@error
        WHERE id=@id`,
      )
      .run(next);
    return next;
  },
  remove(id: string) {
    getDb().prepare('DELETE FROM files WHERE id = ?').run(id);
  },
  sumSize(): number {
    const row = getDb()
      .prepare('SELECT COALESCE(SUM(size),0) as total FROM files')
      .get() as { total: number };
    return row.total || 0;
  },
};

export const jobRepo = {
  list(limit = 50): PostProcessJob[] {
    const rows = getDb()
      .prepare(
        'SELECT * FROM postprocess_jobs ORDER BY created_at DESC LIMIT ?',
      )
      .all(limit);
    return rows.map(rowToJob);
  },
  get(id: string): PostProcessJob | null {
    const row = getDb()
      .prepare('SELECT * FROM postprocess_jobs WHERE id = ?')
      .get(id);
    return row ? rowToJob(row) : null;
  },
  create(j: PostProcessJob) {
    getDb()
      .prepare(
        `INSERT INTO postprocess_jobs (
          id, trigger, file_id, streamer_name, filename, status, log, created_at, finished_at
        ) VALUES (
          @id, @trigger, @fileId, @streamerName, @filename, @status, @log, @createdAt, @finishedAt
        )`,
      )
      .run(j);
  },
  update(id: string, patch: Partial<PostProcessJob>) {
    const cur = jobRepo.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id };
    getDb()
      .prepare(
        `UPDATE postprocess_jobs SET
          trigger=@trigger, file_id=@fileId, streamer_name=@streamerName,
          filename=@filename, status=@status, log=@log, finished_at=@finishedAt
        WHERE id=@id`,
      )
      .run(next);
    return next;
  },
};

export function syncFilesFromDisk(recordingsDir: string) {
  if (!fs.existsSync(recordingsDir)) return;
  const walk = (dir: string, base = '') => {
    for (const name of fs.readdirSync(dir)) {
      const abs = pathJoin(dir, name);
      const rel = pathJoin(base, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!/\.(mp4|mkv|ts|flv|m4a)$/i.test(name)) continue;
      if (fileRepo.getByPath(abs)) continue;
      const now = new Date().toISOString();
      const streamerName = base.split(/[\\/]/)[0] || 'unknown';
      fileRepo.create({
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        streamerId: null,
        streamerName,
        filename: name,
        relativePath: rel,
        absolutePath: abs,
        size: st.size,
        durationSec: null,
        format: name.split('.').pop()?.toLowerCase() || 'mp4',
        status: 'ready',
        createdAt: st.mtime.toISOString(),
        updatedAt: now,
        uploadedAt: null,
        remotePath: null,
        error: null,
      });
    }
  };
  walk(recordingsDir);
}

function pathJoin(...parts: string[]) {
  return parts.filter(Boolean).join('/').replace(/\\/g, '/');
}

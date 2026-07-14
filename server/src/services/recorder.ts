import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { loadSettings } from '../config.js';
import { fileRepo, streamerRepo } from '../db/index.js';
import type {
  DownloaderType,
  PostProcessTrigger,
  Streamer,
} from '../types.js';
import {
  ensureDir,
  fileSize,
  formatStamp,
  newId,
  nowIso,
  parseDurationToSeconds,
  runCommand,
  safeName,
} from '../utils.js';
import { postProcessService } from './postprocess.js';

export interface ActiveRecording {
  streamerId: string;
  roomId: string;
  streamUrl: string;
  downloader: DownloaderType;
  child: ChildProcess;
  currentFileId: string;
  currentFilePath: string;
  segmentIndex: number;
  startedAt: Date;
  stopReason?: string;
  stopping: boolean;
  /** resolve 时表示录制已完全停止（状态已写库） */
  donePromise: Promise<void>;
  resolveDone: () => void;
}

/**
 * 三引擎录制:
 * - ffmpeg: 直接拉 flv/hls 写文件，支持 -t 切片
 * - mesio:  CLI 拉流（若不可用自动回退 ffmpeg）
 * - bililive: BililiveRecorder.Cli 录制（若不可用自动回退 ffmpeg）
 */
export class RecorderService {
  private active = new Map<string, ActiveRecording>();

  isRecording(streamerId: string) {
    return this.active.has(streamerId);
  }

  listActive() {
    return Array.from(this.active.values()).map((a) => ({
      streamerId: a.streamerId,
      roomId: a.roomId,
      downloader: a.downloader,
      filePath: a.currentFilePath,
      startedAt: a.startedAt.toISOString(),
      segmentIndex: a.segmentIndex,
    }));
  }

  getActiveCount() {
    return this.active.size;
  }

  async start(opts: {
    streamer: Streamer;
    roomId: string;
    streamUrl: string;
    title?: string;
  }) {
    const { streamer, roomId, streamUrl } = opts;
    if (this.active.has(streamer.id)) {
      return this.active.get(streamer.id)!;
    }

    const settings = loadSettings();
    if (this.active.size >= settings.maxConcurrentRecordings) {
      throw new Error(
        `已达到最大并发录制数 ${settings.maxConcurrentRecordings}`,
      );
    }

    const downloader = this.resolveDownloader(streamer);
    const owner = safeName(streamer.name || 'unknown');
    const dir = path.join(settings.recordingsDir, owner);
    ensureDir(dir);

    const segmentSec = parseDurationToSeconds(settings.segmentDuration);
    const session = {
      streamer,
      roomId,
      streamUrl,
      downloader,
      dir,
      title: opts.title || streamer.title || 'live',
      segmentSec,
      segmentIndex: 0,
    };

    await this.spawnSegment(session, 'stream_end');
    streamerRepo.update(streamer.id, {
      status: 'recording',
      lastLiveAt: nowIso(),
      lastError: null,
      roomId,
      title: opts.title || streamer.title,
    });
    return this.active.get(streamer.id)!;
  }

  async stop(streamerId: string, reason: PostProcessTrigger = 'manual_stop') {
    const rec = this.active.get(streamerId);
    if (!rec) return false;
    rec.stopping = true;
    rec.stopReason = reason;

    try {
      // 优雅结束
      if (!rec.child.killed) {
        rec.child.kill('SIGINT');
        await new Promise((r) => setTimeout(r, 1500));
        if (!rec.child.killed) rec.child.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 1000));
        if (!rec.child.killed) rec.child.kill('SIGKILL');
      }
    } catch {
      // ignore
    }

    // 3s 兜底：万一 close 事件未触发
    const fallbackTimer = setTimeout(() => {
      if (this.active.get(streamerId) === rec) {
        this.finalize(rec, reason);
      }
    }, 3000);

    // 等待 close 事件触发的 finalize（或超时）
    const timeout = new Promise<void>((r) => setTimeout(r, 5000));
    await Promise.race([rec.donePromise, timeout]);
    clearTimeout(fallbackTimer);

    return true;
  }

  async stopAll(reason: PostProcessTrigger = 'manual_stop') {
    const ids = Array.from(this.active.keys());
    for (const id of ids) {
      await this.stop(id, reason);
    }
  }

  private resolveDownloader(streamer: Streamer): DownloaderType {
    const settings = loadSettings();
    if (streamer.downloader && streamer.downloader !== 'global') {
      return streamer.downloader;
    }
    return settings.downloader;
  }

  private async spawnSegment(
    session: {
      streamer: Streamer;
      roomId: string;
      streamUrl: string;
      downloader: DownloaderType;
      dir: string;
      title: string;
      segmentSec: number;
      segmentIndex: number;
    },
    endTrigger: PostProcessTrigger,
  ) {
    const settings = loadSettings();
    const stamp = formatStamp();
    const idx = String(session.segmentIndex).padStart(3, '0');
    const base = `${safeName(session.streamer.name)}_${stamp}_s${idx}`;

    // bililive/mesio 可能输出 flv/ts；统一先落到中间格式，后处理转 mp4
    let ext = 'flv';
    if (session.downloader === 'ffmpeg') {
      ext = settings.autoTranscode ? 'ts' : 'mp4';
    }
    const filename = `${base}.${ext}`;
    const filePath = path.join(session.dir, filename);
    const fileId = newId('file');
    const rel = path
      .relative(settings.recordingsDir, filePath)
      .replace(/\\/g, '/');

    fileRepo.create({
      id: fileId,
      streamerId: session.streamer.id,
      streamerName: session.streamer.name,
      filename,
      relativePath: rel,
      absolutePath: filePath,
      size: 0,
      durationSec: null,
      format: ext,
      status: 'recording',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      uploadedAt: null,
      remotePath: null,
      error: null,
    });

    const { child, engine } = this.spawnEngine({
      downloader: session.downloader,
      streamUrl: session.streamUrl,
      filePath,
      segmentSec: session.segmentSec,
      roomId: session.roomId,
      settings,
    });

    let resolveDone: () => void = () => {};
    const donePromise = new Promise<void>((r) => { resolveDone = r; });

    const rec: ActiveRecording = {
      streamerId: session.streamer.id,
      roomId: session.roomId,
      streamUrl: session.streamUrl,
      downloader: engine,
      child,
      currentFileId: fileId,
      currentFilePath: filePath,
      segmentIndex: session.segmentIndex,
      startedAt: new Date(),
      stopping: false,
      donePromise,
      resolveDone,
    };
    this.active.set(session.streamer.id, rec);

    child.on('close', async (code) => {
      const current = this.active.get(session.streamer.id);
      if (!current || current.currentFileId !== fileId) return;

      const size = fileSize(filePath);
      const existed = fs.existsSync(filePath) && size > 1024;

      if (existed) {
        fileRepo.update(fileId, {
          size,
          status: 'ready',
        });
        // 切片完成触发后处理
        const trigger: PostProcessTrigger = current.stopping
          ? (current.stopReason as PostProcessTrigger) || 'manual_stop'
          : session.segmentSec > 0 && code === 0
            ? 'segment'
            : endTrigger;
        postProcessService.enqueue(fileId, trigger);
      } else {
        // 文件可能因 move 模式已被删除，这种情况下不报错
        const stillExists = fs.existsSync(filePath);
        if (stillExists) {
          fileRepo.update(fileId, {
            status: 'error',
            error: `录制结束但文件无效 code=${code}`,
            size,
          });
        } else {
          fileRepo.update(fileId, {
            status: 'uploaded',
            size: 0,
            error: null,
            absolutePath: '',
          });
        }
      }

      // 若非主动停止且仍应继续（切片或异常重启由 monitor 处理）
      if (
        !current.stopping &&
        session.segmentSec > 0 &&
        code === 0 &&
        existed
      ) {
        // 自动下一段
        session.segmentIndex += 1;
        try {
          await this.spawnSegment(session, 'stream_end');
          return;
        } catch (e) {
          console.error('[recorder] next segment failed', e);
        }
      }

      this.finalize(current, current.stopReason as PostProcessTrigger || 'stream_end');
    });
  }

  private finalize(rec: ActiveRecording, reason: PostProcessTrigger) {
    this.active.delete(rec.streamerId);
    const s = streamerRepo.get(rec.streamerId);
    if (s && s.status === 'recording') {
      streamerRepo.update(rec.streamerId, {
        status: 'offline',
      });
    }
    rec.resolveDone();
    console.log(
      `[recorder] finalize streamer=${rec.streamerId} reason=${reason}`,
    );
  }

  private spawnEngine(opts: {
    downloader: DownloaderType;
    streamUrl: string;
    filePath: string;
    segmentSec: number;
    roomId: string;
    settings: ReturnType<typeof loadSettings>;
  }): { child: ChildProcess; engine: DownloaderType } {
    const { streamUrl, filePath, segmentSec, settings } = opts;
    let downloader = opts.downloader;

    const trySpawn = (type: DownloaderType): ChildProcess | null => {
      try {
        if (type === 'ffmpeg') {
          const args = [
            '-y',
            '-hide_banner',
            '-loglevel',
            'warning',
            '-rw_timeout',
            '10000000',
            '-timeout',
            '10000000',
            '-i',
            streamUrl,
            '-c',
            'copy',
          ];
          if (segmentSec > 0) {
            args.push('-t', String(segmentSec));
          }
          // ts/mp4
          if (filePath.endsWith('.mp4')) {
            args.push('-movflags', '+faststart');
          }
          args.push(filePath);
          const { child } = runCommand(settings.ffmpegPath, args, {
            onStderr: (l) => console.log(`[ffmpeg:${opts.roomId}] ${l}`),
          });
          return child;
        }

        if (type === 'mesio') {
          // mesio 常见用法: mesio <url> -o <file>
          const args = [streamUrl, '-o', filePath];
          if (segmentSec > 0) {
            args.push('--duration', String(segmentSec));
          }
          const { child } = runCommand(settings.mesioPath, args, {
            onStderr: (l) => console.log(`[mesio:${opts.roomId}] ${l}`),
            onStdout: (l) => console.log(`[mesio:${opts.roomId}] ${l}`),
          });
          return child;
        }

        if (type === 'bililive') {
          // BililiveRecorder.Cli run <url> --work-directory <dir>
          const workDir = path.dirname(filePath);
          const args = [
            'run',
            streamUrl,
            '--work-directory',
            workDir,
          ];
          const { child } = runCommand(settings.bililivePath, args, {
            onStderr: (l) => console.log(`[bililive:${opts.roomId}] ${l}`),
            onStdout: (l) => console.log(`[bililive:${opts.roomId}] ${l}`),
          });
          return child;
        }
      } catch (e) {
        console.error(`[recorder] spawn ${type} failed`, e);
      }
      return null;
    };

    let child = trySpawn(downloader);
    if (!child && downloader !== 'ffmpeg') {
      console.warn(
        `[recorder] ${downloader} 不可用，回退 ffmpeg`,
      );
      downloader = 'ffmpeg';
      // 回退时修正扩展名
      if (!filePath.endsWith('.ts') && !filePath.endsWith('.mp4') && !filePath.endsWith('.flv')) {
        // keep
      }
      child = trySpawn('ffmpeg');
    }
    if (!child) {
      throw new Error('无法启动任何录制引擎');
    }
    return { child, engine: downloader };
  }
}

export const recorderService = new RecorderService();

import fs from 'node:fs';
import path from 'node:path';
import { PATHS, loadSettings } from '../config.js';
import { fileRepo, jobRepo } from '../db/index.js';
import type { PostProcessTrigger, RecordingFile } from '../types.js';
import {
  ensureDir,
  newId,
  nowIso,
  runCommand,
  safeName,
} from '../utils.js';

/**
 * 后处理：转码(可选) + 执行脚本(默认 rclone 上传到 pikpak:red/主播名/)
 */
export class PostProcessService {
  private queue: string[] = [];
  private running = false;

  enqueue(fileId: string, trigger: PostProcessTrigger) {
    this.queue.push(JSON.stringify({ fileId, trigger }));
    void this.pump();
  }

  async runNow(fileId: string, trigger: PostProcessTrigger = 'manual') {
    return this.execute(fileId, trigger);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const raw = this.queue.shift()!;
        const { fileId, trigger } = JSON.parse(raw) as {
          fileId: string;
          trigger: PostProcessTrigger;
        };
        try {
          await this.execute(fileId, trigger);
        } catch (e) {
          console.error('[postprocess]', e);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private shouldRun(trigger: PostProcessTrigger): boolean {
    const s = loadSettings();
    if (trigger === 'manual') return true;
    if (trigger === 'stream_end') return s.postProcessOnStreamEnd;
    if (trigger === 'manual_stop') return s.postProcessOnManualStop;
    if (trigger === 'segment') return s.postProcessOnSegment;
    return false;
  }

  private async execute(fileId: string, trigger: PostProcessTrigger) {
    if (!this.shouldRun(trigger)) {
      return { skipped: true };
    }

    const file = fileRepo.get(fileId);
    if (!file) throw new Error(`文件不存在: ${fileId}`);
    if (!fs.existsSync(file.absolutePath)) {
      throw new Error(`本地文件丢失: ${file.absolutePath}`);
    }

    const settings = loadSettings();
    const jobId = newId('job');
    const job = {
      id: jobId,
      trigger,
      fileId: file.id,
      streamerName: file.streamerName,
      filename: file.filename,
      status: 'running' as const,
      log: '',
      createdAt: nowIso(),
      finishedAt: null as string | null,
    };
    jobRepo.create(job);
    fileRepo.update(file.id, { status: 'processing' });

    let log = '';
    const append = (line: string) => {
      log += line + '\n';
      jobRepo.update(jobId, { log });
    };

    try {
      let workFile = file;

      // 自动转码为 mp4
      if (settings.autoTranscode && !file.filename.toLowerCase().endsWith('.mp4')) {
        append(`[transcode] 开始转码 -> mp4`);
        workFile = await this.transcodeToMp4(file, settings.ffmpegPath, append);
      } else if (
        settings.autoTranscode &&
        file.filename.toLowerCase().endsWith('.ts')
      ) {
        append(`[transcode] ts 封装为 mp4`);
        workFile = await this.transcodeToMp4(file, settings.ffmpegPath, append);
      } else {
        append(`[transcode] 跳过（已是 mp4 或未开启自动转码）`);
      }

      // 写临时脚本执行
      const scriptDir = path.join(PATHS.data, 'scripts');
      ensureDir(scriptDir);
      const scriptPath = path.join(scriptDir, `post_${jobId}.sh`);
      const scriptBody = settings.postProcessScript || '';
      fs.writeFileSync(scriptPath, scriptBody.replace(/\r\n/g, '\n'), {
        mode: 0o755,
      });
      try {
        fs.chmodSync(scriptPath, 0o755);
      } catch {
        // ignore on some fs
      }

      const remotePath = `${settings.rcloneRemote}:${settings.rcloneRemotePath}/${safeName(workFile.streamerName)}/${workFile.filename}`;
      append(`[script] 执行后处理脚本 trigger=${trigger}`);
      append(`[script] mode=${settings.rcloneMode} delete_local=${settings.rcloneDeleteLocalOnMove}`);
      append(`[script] remote=${remotePath}`);

      const { done } = runCommand('sh', [scriptPath], {
        env: {
          RED_FILE_PATH: workFile.absolutePath,
          RED_FILE_NAME: workFile.filename,
          RED_STREAMER: safeName(workFile.streamerName),
          RED_REMOTE: settings.rcloneRemote,
          RED_REMOTE_ROOT: settings.rcloneRemotePath,
          RED_TRIGGER: trigger,
          RED_RCLONE: settings.rclonePath,
          RED_RCLONE_MODE: settings.rcloneMode,
          RED_DELETE_LOCAL: settings.rcloneDeleteLocalOnMove ? '1' : '0',
          RCLONE_CONFIG: process.env.RCLONE_CONFIG || '/config/rclone/rclone.conf',
          HOME: process.env.HOME || '/home/node',
          PATH: process.env.PATH,
        },
        onStdout: (line) => append(`[out] ${line}`),
        onStderr: (line) => append(`[err] ${line}`),
      });

      const result = await done;
      if (result.code !== 0) {
        throw new Error(`脚本退出码 ${result.code}`);
      }

      // move 模式兜底：rclone move 已自带删除；此处仅在脚本可能未删时强制清一次
      if (
        settings.rcloneMode === 'move' &&
        settings.rcloneDeleteLocalOnMove &&
        workFile.absolutePath &&
        fs.existsSync(workFile.absolutePath)
      ) {
        try {
          fs.unlinkSync(workFile.absolutePath);
          append('[cleanup] move 模式: 已删除本地文件');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          append(`[cleanup] 删除本地文件失败: ${msg}`);
        }
      }

      const stillExists =
        !!workFile.absolutePath && fs.existsSync(workFile.absolutePath);
      fileRepo.update(workFile.id, {
        status: 'uploaded',
        uploadedAt: nowIso(),
        remotePath,
        absolutePath: stillExists ? workFile.absolutePath : '',
        size: stillExists ? fs.statSync(workFile.absolutePath).size : 0,
        error: null,
      });
      jobRepo.update(jobId, {
        status: 'success',
        log,
        finishedAt: nowIso(),
      });
      append('[done] 后处理成功');
      return { ok: true, remotePath, deleted: !stillExists };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      append(`[fail] ${msg}`);
      fileRepo.update(file.id, { status: 'error', error: msg });
      jobRepo.update(jobId, {
        status: 'failed',
        log,
        finishedAt: nowIso(),
      });
      throw error;
    } finally {
      // 清理临时脚本
      try {
        const scriptPath = path.join(
          PATHS.data,
          'scripts',
          `post_${jobId}.sh`,
        );
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      } catch {
        // ignore
      }
    }
  }

  private async transcodeToMp4(
    file: RecordingFile,
    ffmpegPath: string,
    append: (s: string) => void,
  ): Promise<RecordingFile> {
    const dir = path.dirname(file.absolutePath);
    const base = path.basename(file.filename, path.extname(file.filename));
    const outName = `${base}.mp4`;
    const outPath = path.join(dir, outName);

    // copy 封装优先（ts/flv 常可 -c copy），失败再重编码
    const tryCopy = await this.runFfmpeg(
      ffmpegPath,
      [
        '-y',
        '-i',
        file.absolutePath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outPath,
      ],
      append,
    );

    if (!tryCopy || !fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
      append('[transcode] copy 失败，尝试重编码');
      const re = await this.runFfmpeg(
        ffmpegPath,
        [
          '-y',
          '-i',
          file.absolutePath,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outPath,
        ],
        append,
      );
      if (!re || !fs.existsSync(outPath)) {
        throw new Error('转码失败');
      }
    }

    // 删除源文件（非 mp4）
    if (file.absolutePath !== outPath) {
      try {
        fs.unlinkSync(file.absolutePath);
      } catch {
        // ignore
      }
    }

    const size = fs.statSync(outPath).size;
    const rel = path
      .relative(loadSettings().recordingsDir, outPath)
      .replace(/\\/g, '/');

    const updated = fileRepo.update(file.id, {
      filename: outName,
      absolutePath: outPath,
      relativePath: rel,
      size,
      format: 'mp4',
      status: 'ready',
    });
    return updated || file;
  }

  private async runFfmpeg(
    ffmpegPath: string,
    args: string[],
    append: (s: string) => void,
  ) {
    append(`[ffmpeg] ${ffmpegPath} ${args.join(' ')}`);
    const { done } = runCommand(ffmpegPath, args, {
      onStdout: (l) => append(`[ffmpeg] ${l}`),
      onStderr: (l) => append(`[ffmpeg] ${l}`),
    });
    const r = await done;
    return r.code === 0;
  }
}

export const postProcessService = new PostProcessService();

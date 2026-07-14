import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from '../config.js';
import { fileRepo, syncFilesFromDisk } from '../db/index.js';
import { postProcessService } from '../services/postprocess.js';
import type { ApiResponse, RecordingFile } from '../types.js';

export const filesRouter = Router();

filesRouter.get('/', (_req, res) => {
  const settings = loadSettings();
  syncFilesFromDisk(settings.recordingsDir);
  const data = fileRepo.list();
  res.json({ ok: true, data } satisfies ApiResponse<RecordingFile[]>);
});

filesRouter.get('/:id', (req, res) => {
  const f = fileRepo.get(req.params.id);
  if (!f) {
    res.status(404).json({ ok: false, error: '文件不存在' } satisfies ApiResponse);
    return;
  }
  res.json({ ok: true, data: f } satisfies ApiResponse<RecordingFile>);
});

filesRouter.delete('/:id', (req, res) => {
  const f = fileRepo.get(req.params.id);
  if (!f) {
    res.status(404).json({ ok: false, error: '文件不存在' } satisfies ApiResponse);
    return;
  }
  // 兼容 move 后 absolutePath 已清空的情况
  if (f.absolutePath) {
    try {
      if (fs.existsSync(f.absolutePath)) {
        fs.unlinkSync(f.absolutePath);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res
        .status(500)
        .json({ ok: false, error: `删除物理文件失败: ${msg}` } satisfies ApiResponse);
      return;
    }
  }
  fileRepo.remove(f.id);
  res.json({ ok: true, message: '已删除' } satisfies ApiResponse);
});

filesRouter.post('/:id/upload', async (req, res) => {
  try {
    await postProcessService.runNow(req.params.id, 'manual');
    const f = fileRepo.get(req.params.id);
    res.json({ ok: true, data: f, message: '上传任务完成' } satisfies ApiResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

filesRouter.post('/sync', (_req, res) => {
  const settings = loadSettings();
  syncFilesFromDisk(settings.recordingsDir);
  res.json({
    ok: true,
    data: fileRepo.list(),
    message: '已同步磁盘文件',
  } satisfies ApiResponse);
});

/** 安全校验：仅允许 recordings 目录内文件 */
export function resolveMediaPath(relativePath: string): string | null {
  const settings = loadSettings();
  const root = path.resolve(settings.recordingsDir);
  const abs = path.resolve(root, relativePath);
  // 防止 /data/recordings2 之类的目录穿越
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  if (!fs.statSync(abs).isFile()) return null;
  return abs;
}

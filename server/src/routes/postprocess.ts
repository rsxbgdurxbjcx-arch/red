import { Router } from 'express';
import { z } from 'zod';
import { loadSettings, saveSettings } from '../config.js';
import { jobRepo } from '../db/index.js';
import { postProcessService } from '../services/postprocess.js';
import type { ApiResponse, PostProcessJob, Settings } from '../types.js';

export const postprocessRouter = Router();

postprocessRouter.get('/jobs', (req, res) => {
  const limit = Number(req.query.limit || 50);
  const data = jobRepo.list(Number.isFinite(limit) ? limit : 50);
  res.json({ ok: true, data } satisfies ApiResponse<PostProcessJob[]>);
});

postprocessRouter.get('/jobs/:id', (req, res) => {
  const job = jobRepo.get(req.params.id);
  if (!job) {
    res.status(404).json({ ok: false, error: '任务不存在' } satisfies ApiResponse);
    return;
  }
  res.json({ ok: true, data: job } satisfies ApiResponse<PostProcessJob>);
});

const scriptSchema = z.object({
  postProcessScript: z.string().optional(),
  postProcessOnStreamEnd: z.boolean().optional(),
  postProcessOnManualStop: z.boolean().optional(),
  postProcessOnSegment: z.boolean().optional(),
  rcloneRemote: z.string().optional(),
  rcloneRemotePath: z.string().optional(),
  rcloneMode: z.enum(['move', 'copy']).optional(),
  rcloneDeleteLocalOnMove: z.boolean().optional(),
});

postprocessRouter.get('/config', (_req, res) => {
  const s = loadSettings();
  res.json({
    ok: true,
    data: {
      postProcessScript: s.postProcessScript,
      postProcessOnStreamEnd: s.postProcessOnStreamEnd,
      postProcessOnManualStop: s.postProcessOnManualStop,
      postProcessOnSegment: s.postProcessOnSegment,
      rcloneRemote: s.rcloneRemote,
      rcloneRemotePath: s.rcloneRemotePath,
      rcloneMode: s.rcloneMode,
      rcloneDeleteLocalOnMove: s.rcloneDeleteLocalOnMove,
    },
  } satisfies ApiResponse);
});

postprocessRouter.put('/config', (req, res) => {
  try {
    const body = scriptSchema.parse(req.body);
    const cur = loadSettings();
    const next: Settings = {
      ...cur,
      ...body,
    };
    saveSettings(next);
    res.json({
      ok: true,
      data: {
        postProcessScript: next.postProcessScript,
        postProcessOnStreamEnd: next.postProcessOnStreamEnd,
        postProcessOnManualStop: next.postProcessOnManualStop,
        postProcessOnSegment: next.postProcessOnSegment,
        rcloneRemote: next.rcloneRemote,
        rcloneRemotePath: next.rcloneRemotePath,
        rcloneMode: next.rcloneMode,
        rcloneDeleteLocalOnMove: next.rcloneDeleteLocalOnMove,
      },
      message: '后处理配置已保存',
    } satisfies ApiResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

postprocessRouter.post('/run/:fileId', async (req, res) => {
  try {
    await postProcessService.runNow(req.params.fileId, 'manual');
    res.json({ ok: true, message: '已执行后处理' } satisfies ApiResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

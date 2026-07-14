import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../config.js';
import { monitorService } from '../services/monitor.js';
import type { ApiResponse, Settings } from '../types.js';
import { parseDurationToSeconds, secondsToHms } from '../utils.js';

export const settingsRouter = Router();

const schema = z.object({
  pollIntervalSec: z.number().int().min(5).max(3600).optional(),
  segmentDuration: z.string().min(1).optional(),
  downloader: z.enum(['ffmpeg', 'mesio', 'bililive']).optional(),
  autoTranscode: z.boolean().optional(),
  cookie: z.string().optional(),
  rcloneRemote: z.string().optional(),
  rcloneRemotePath: z.string().optional(),
  rcloneMode: z.enum(['move', 'copy']).optional(),
  rcloneDeleteLocalOnMove: z.boolean().optional(),
  postProcessScript: z.string().optional(),
  postProcessOnStreamEnd: z.boolean().optional(),
  postProcessOnManualStop: z.boolean().optional(),
  postProcessOnSegment: z.boolean().optional(),
  ffmpegPath: z.string().optional(),
  mesioPath: z.string().optional(),
  bililivePath: z.string().optional(),
  rclonePath: z.string().optional(),
  maxConcurrentRecordings: z.number().int().min(1).max(50).optional(),
});

settingsRouter.get('/', (_req, res) => {
  const data = loadSettings();
  res.json({ ok: true, data } satisfies ApiResponse<Settings>);
});

settingsRouter.put('/', (req, res) => {
  try {
    const body = schema.parse(req.body);
    const cur = loadSettings();

    if (body.segmentDuration) {
      const sec = parseDurationToSeconds(body.segmentDuration);
      // 规范化为 HH:MM:SS
      body.segmentDuration = secondsToHms(sec);
    }

    const next: Settings = { ...cur, ...body };
    saveSettings(next);

    // 轮询间隔变更时重启监控
    if (
      body.pollIntervalSec !== undefined &&
      body.pollIntervalSec !== cur.pollIntervalSec
    ) {
      monitorService.restart();
    }

    res.json({
      ok: true,
      data: next,
      message: '设置已保存并生效',
    } satisfies ApiResponse<Settings>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

settingsRouter.post('/reset', (_req, res) => {
  saveSettings({ ...DEFAULT_SETTINGS });
  monitorService.restart();
  res.json({
    ok: true,
    data: loadSettings(),
    message: '已恢复默认设置',
  } satisfies ApiResponse<Settings>);
});

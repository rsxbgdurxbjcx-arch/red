import { Router } from 'express';
import { z } from 'zod';
import { loadSettings } from '../config.js';
import { streamerRepo } from '../db/index.js';
import { monitorService } from '../services/monitor.js';
import { recorderService } from '../services/recorder.js';
import type { ApiResponse, Streamer } from '../types.js';
import { newId, nowIso } from '../utils.js';
import { XhsParser } from '../xhs/parser.js';

export const streamersRouter = Router();

function normalizeUrl(input: string) {
  const u = input.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

const urlLike = z
  .string()
  .min(8)
  .refine(
    (v) =>
      /^(https?:\/\/)?([\w-]+\.)?(xiaohongshu\.com|xhslink\.com)\//i.test(
        v.trim(),
      ) || /^https?:\/\//i.test(v.trim()),
    '请输入有效的小红书链接',
  );

const upsertSchema = z.object({
  name: z.string().optional(),
  profileUrl: urlLike,
  enabled: z.boolean().optional(),
  downloader: z
    .enum(['global', 'ffmpeg', 'mesio', 'bililive'])
    .optional(),
  redId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
});

streamersRouter.get('/', (_req, res) => {
  const data = streamerRepo.list();
  const body: ApiResponse<Streamer[]> = { ok: true, data };
  res.json(body);
});

streamersRouter.get('/:id', (req, res) => {
  const s = streamerRepo.get(req.params.id);
  if (!s) {
    res.status(404).json({ ok: false, error: '主播不存在' } satisfies ApiResponse);
    return;
  }
  res.json({ ok: true, data: s } satisfies ApiResponse<Streamer>);
});

streamersRouter.post('/', async (req, res) => {
  try {
    const parsed = upsertSchema.parse(req.body);
    const settings = loadSettings();
    const parser = new XhsParser({ cookie: settings.cookie || undefined });
    const profileUrl = normalizeUrl(parsed.profileUrl);

    if (!parser.matchURL(profileUrl)) {
      res.status(400).json({
        ok: false,
        error: '请输入小红书主页/直播/分享链接 (xiaohongshu.com 或 xhslink.com)',
      } satisfies ApiResponse);
      return;
    }

    const info = await parser.resolveFromProfileUrl(
      profileUrl,
      settings.cookie || undefined,
    );

    const now = nowIso();
    const streamer: Streamer = {
      id: newId('st'),
      name: parsed.name?.trim() || info.name || '未知主播',
      profileUrl,
      roomId: parsed.roomId ?? info.roomId,
      userId: info.userId,
      redId: parsed.redId ?? info.redId,
      avatar: info.avatar || null,
      title: info.title || null,
      status: info.living ? 'online' : 'offline',
      enabled: parsed.enabled ?? true,
      downloader: parsed.downloader ?? 'global',
      lastError: null,
      lastCheckedAt: now,
      lastLiveAt: info.living ? now : null,
      createdAt: now,
      updatedAt: now,
    };

    streamerRepo.create(streamer);
    res.status(201).json({ ok: true, data: streamer } satisfies ApiResponse<Streamer>);

    // 异步立即检查一次
    void monitorService.checkOne(streamer.id).catch(() => undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

streamersRouter.put('/:id', async (req, res) => {
  try {
    const cur = streamerRepo.get(req.params.id);
    if (!cur) {
      res.status(404).json({ ok: false, error: '主播不存在' } satisfies ApiResponse);
      return;
    }
    const parsed = upsertSchema
      .partial()
      .extend({
        profileUrl: urlLike.optional(),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);

    let patch: Partial<Streamer> = {
      name: parsed.name ?? cur.name,
      enabled: parsed.enabled ?? cur.enabled,
      downloader: parsed.downloader ?? cur.downloader,
      redId: parsed.redId === undefined ? cur.redId : parsed.redId,
      roomId: parsed.roomId === undefined ? cur.roomId : parsed.roomId,
    };

    if (parsed.profileUrl && normalizeUrl(parsed.profileUrl) !== cur.profileUrl) {
      const settings = loadSettings();
      const parser = new XhsParser({ cookie: settings.cookie || undefined });
      const profileUrl = normalizeUrl(parsed.profileUrl);
      const info = await parser.resolveFromProfileUrl(
        profileUrl,
        settings.cookie || undefined,
      );
      patch = {
        ...patch,
        profileUrl,
        userId: info.userId,
        redId: parsed.redId ?? info.redId,
        roomId: parsed.roomId ?? info.roomId,
        avatar: info.avatar || cur.avatar,
        name: parsed.name?.trim() || info.name || cur.name,
      };
    }

    const next = streamerRepo.update(cur.id, patch);
    res.json({ ok: true, data: next } satisfies ApiResponse<Streamer | null>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

streamersRouter.delete('/:id', async (req, res) => {
  const cur = streamerRepo.get(req.params.id);
  if (!cur) {
    res.status(404).json({ ok: false, error: '主播不存在' } satisfies ApiResponse);
    return;
  }
  if (recorderService.isRecording(cur.id)) {
    await recorderService.stop(cur.id, 'manual_stop');
  }
  streamerRepo.remove(cur.id);
  res.json({ ok: true, message: '已删除' } satisfies ApiResponse);
});

streamersRouter.post('/:id/check', async (req, res) => {
  try {
    const data = await monitorService.checkOne(req.params.id);
    if (!data) {
      res.status(404).json({ ok: false, error: '主播不存在' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data } satisfies ApiResponse<Streamer>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

streamersRouter.post('/:id/stop', async (req, res) => {
  const ok = await recorderService.stop(req.params.id, 'manual_stop');
  res.json({
    ok: true,
    data: { stopped: ok },
    message: ok ? '已请求停止录制' : '当前未在录制',
  } satisfies ApiResponse);
});

streamersRouter.post('/:id/start', async (req, res) => {
  try {
    const s = streamerRepo.get(req.params.id);
    if (!s) {
      res.status(404).json({ ok: false, error: '主播不存在' } satisfies ApiResponse);
      return;
    }
    await monitorService.checkOne(s.id);
    const latest = streamerRepo.get(s.id);
    if (!latest) {
      res.status(404).json({ ok: false, error: '主播不存在' } satisfies ApiResponse);
      return;
    }
    res.json({ ok: true, data: latest } satisfies ApiResponse<Streamer>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg } satisfies ApiResponse);
  }
});

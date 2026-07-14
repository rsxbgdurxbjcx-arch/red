import { loadSettings } from '../config.js';
import { streamerRepo } from '../db/index.js';
import type { Streamer } from '../types.js';
import { nowIso } from '../utils.js';
import { XhsParser } from '../xhs/parser.js';
import { recorderService } from './recorder.js';

/**
 * 循环监控主播开播状态并自动开录
 */
export class MonitorService {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private startedAt = Date.now();

  start() {
    if (this.timer) return;
    const settings = loadSettings();
    const interval = Math.max(5, settings.pollIntervalSec) * 1000;
    console.log(`[monitor] start poll every ${interval / 1000}s`);
    this.timer = setInterval(() => void this.tick(), interval);
    void this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  restart() {
    this.stop();
    this.start();
  }

  getUptimeSec() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  async checkOne(streamerId: string) {
    const s = streamerRepo.get(streamerId);
    if (!s) throw new Error('主播不存在');
    await this.checkStreamer(s);
    return streamerRepo.get(streamerId);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const list = streamerRepo.list().filter((s) => s.enabled);
      for (const s of list) {
        try {
          await this.checkStreamer(s);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[monitor] ${s.name}: ${msg}`);
          streamerRepo.update(s.id, {
            status: 'parse_error',
            lastError: msg,
            lastCheckedAt: nowIso(),
          });
        }
        // 轻微错开请求
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      this.ticking = false;
    }
  }

  private async checkStreamer(streamer: Streamer) {
    // 已在录制则只更新时间戳
    if (recorderService.isRecording(streamer.id)) {
      streamerRepo.update(streamer.id, {
        status: 'recording',
        lastCheckedAt: nowIso(),
      });
      return;
    }

    const settings = loadSettings();
    const parser = new XhsParser({ cookie: settings.cookie || undefined });

    let roomId: string | null = streamer.roomId;
    let living = false;
    let title = streamer.title || '';
    let owner = streamer.name;
    let avatar = streamer.avatar || '';

    // 策略1（首选，无需特殊签名）：始终尝试从用户主页页面检测直播状态
    // 即使已有旧 roomId，也优先用此策略获取最新 roomId
    if (streamer.userId) {
      try {
        const profileLive = await parser.checkLiveFromProfilePage(streamer.userId);
        if (profileLive.living && profileLive.roomId) {
          living = true;
          roomId = profileLive.roomId;
          title = profileLive.title || title;
          if (profileLive.owner) owner = profileLive.owner;
          if (profileLive.avatar) avatar = profileLive.avatar;
          console.log(`[monitor] profile detect: ${streamer.name} is LIVE roomId=${roomId}`);
        }
      } catch (e) {
        console.warn(
          `[monitor] profile check failed for ${streamer.name}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 策略2（增强）：Cookie + redId → usersearch
    if (!living && settings.cookie && streamer.redId) {
      try {
        const live = await parser.checkLiveByRedId(
          streamer.redId,
          settings.cookie,
        );
        if (live.living) {
          living = true;
          if (live.roomId) roomId = live.roomId;
          if (live.owner) owner = live.owner;
          if (live.avatar) avatar = live.avatar;
          console.log(`[monitor] usersearch detect: ${streamer.name} is LIVE roomId=${roomId}`);
        }
      } catch (e) {
        console.warn(
          `[monitor] usersearch failed for ${streamer.name}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 策略3（兜底）：有旧 roomId 时用直播页确认
    if (!living && roomId) {
      try {
        const info = await parser.getRoomInfo(roomId);
        if (info.living) {
          living = true;
          if (info.roomId) roomId = info.roomId;
          if (info.title) title = info.title;
          if (info.owner) owner = info.owner;
          if (info.avatar) avatar = info.avatar;
          console.log(`[monitor] room page detect: ${streamer.name} is LIVE roomId=${roomId}`);
        } else {
          // roomId 对应的直播已结束，清除旧 roomId 以便下一轮策略1重新检测
          roomId = null;
        }
      } catch (e) {
        // 直播页不可用时清除旧 roomId，让下一轮用其他策略
        roomId = null;
        console.warn(
          `[monitor] room page check failed for ${streamer.name}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 已检测到直播 + 有 roomId → 补标题
    if (living && roomId) {
      try {
        const info = await parser.getRoomInfo(roomId);
        if (info.title) title = info.title;
        if (info.owner) owner = info.owner;
        if (info.avatar) avatar = info.avatar;
        living = info.living || living;
      } catch {
        // 已有的检测结果足以继续
      }
    }

    streamerRepo.update(streamer.id, {
      name: owner || streamer.name,
      avatar: avatar || streamer.avatar,
      title: title || streamer.title,
      roomId,
      lastCheckedAt: nowIso(),
      lastError: living ? null : '暂未检测到开播。系统每轮持续监控，直播开始后自动录制',
      status: living ? 'online' : 'offline',
      lastLiveAt: living ? nowIso() : streamer.lastLiveAt,
    });

    if (!living || !roomId) return;

    // 获取原画流并开录
    const streams = await parser.getStreams(roomId, ['flv', 'hls']);
    const stream =
      streams[0]?.streams.find((s) => s.format === 'flv') ||
      streams[0]?.streams[0];
    if (!stream?.url) {
      streamerRepo.update(streamer.id, {
        status: 'parse_error',
        lastError: '在播但未解析到流地址',
        lastCheckedAt: nowIso(),
      });
      return;
    }

    const latest = streamerRepo.get(streamer.id)!;
    await recorderService.start({
      streamer: latest,
      roomId,
      streamUrl: stream.url,
      title,
    });
  }
}

export const monitorService = new MonitorService();

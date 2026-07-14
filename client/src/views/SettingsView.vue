<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { useToast } from '../toast';
import type { Settings, SystemStatus } from '../types';

const toast = useToast();
const form = ref<Settings | null>(null);
const status = ref<SystemStatus | null>(null);
const saving = ref(false);
const showCookie = ref(false);

async function load() {
  try {
    const [s, st] = await Promise.all([api.getSettings(), api.status()]);
    form.value = s;
    status.value = st;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function save() {
  if (!form.value) return;
  saving.value = true;
  try {
    const updated = await api.saveSettings({
      pollIntervalSec: Number(form.value.pollIntervalSec),
      segmentDuration: form.value.segmentDuration,
      downloader: form.value.downloader,
      autoTranscode: form.value.autoTranscode,
      cookie: form.value.cookie,
      rcloneRemote: form.value.rcloneRemote,
      rcloneRemotePath: form.value.rcloneRemotePath,
      rcloneMode: form.value.rcloneMode,
      rcloneDeleteLocalOnMove: form.value.rcloneDeleteLocalOnMove,
      ffmpegPath: form.value.ffmpegPath,
      mesioPath: form.value.mesioPath,
      bililivePath: form.value.bililivePath,
      rclonePath: form.value.rclonePath,
      maxConcurrentRecordings: Number(form.value.maxConcurrentRecordings),
    });
    form.value = updated;
    toast.success('已保存');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

async function reset() {
  if (!confirm('确认恢复默认设置？')) return;
  try {
    form.value = await api.resetSettings();
    toast.success('已恢复默认');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function restartMonitor() {
  try {
    await api.restartMonitor();
    toast.success('监控已重启');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

onMounted(() => void load());
</script>

<template>
  <div v-if="form">
    <!-- 录制 -->
    <div class="card stack">
      <div class="item-title">录制设置</div>
      <div class="grid-2">
        <div class="field">
          <label class="label">轮询时间（秒）</label>
          <input v-model.number="form.pollIntervalSec" class="input" type="number" min="5" max="3600" />
          <div class="muted">最小 5 秒</div>
        </div>
        <div class="field">
          <label class="label">时长切片（HH:MM:SS）</label>
          <input v-model="form.segmentDuration" class="input" placeholder="03:00:00" />
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label class="label">全局下载器</label>
          <select v-model="form.downloader" class="select">
            <option value="ffmpeg">FFmpeg</option>
            <option value="mesio">mesio</option>
            <option value="bililive">录播姬</option>
          </select>
        </div>
        <div class="field">
          <label class="label">最大并发录制</label>
          <input v-model.number="form.maxConcurrentRecordings" class="input" type="number" min="1" max="50" />
        </div>
      </div>
      <div class="switch">
        <div><div>自动转码 MP4</div><div class="muted">录制完成自动压制/合并</div></div>
        <label class="toggle"><input v-model="form.autoTranscode" type="checkbox" /><span class="slider" /></label>
      </div>
    </div>

    <!-- Cookie -->
    <div class="card stack" style="margin-top:12px">
      <div class="row space">
        <div class="item-title">小红书 Cookie</div>
        <button class="btn btn-sm" @click="showCookie = !showCookie">{{ showCookie ? '隐藏' : '显示' }}</button>
      </div>
      <div class="field">
        <label class="label">Cookie 字符串（需含 a1 + web_session）</label>
        <textarea v-model="form.cookie" class="textarea" style="min-height:110px" placeholder="a1=...; web_session=...; ..." spellcheck="false" />
      </div>
    </div>

    <!-- 工具路径 -->
    <div class="card stack" style="margin-top:12px">
      <div class="item-title">工具路径</div>
      <div class="grid-2">
        <div class="field"><label class="label">ffmpeg</label><input v-model="form.ffmpegPath" class="input" /></div>
        <div class="field"><label class="label">rclone</label><input v-model="form.rclonePath" class="input" /></div>
        <div class="field"><label class="label">mesio</label><input v-model="form.mesioPath" class="input" /></div>
        <div class="field"><label class="label">录播姬 CLI</label><input v-model="form.bililivePath" class="input" /></div>
      </div>
    </div>

    <!-- 系统状态 -->
    <div class="card" style="margin-top:12px" v-if="status">
      <div class="item-title" style="margin-bottom:8px">系统状态</div>
      <div class="status-grid">
        <div class="status-row"><span class="muted">版本</span><b>{{ status.version }}</b></div>
        <div class="status-row"><span class="muted">运行时间</span><b>{{ status.uptimeSec }} 秒</b></div>
        <div class="status-row"><span class="muted">ffmpeg</span><b :class="status.tools.ffmpeg ? 'ok' : 'err'">{{ status.tools.ffmpeg ? '✓' : '✗' }}</b></div>
        <div class="status-row"><span class="muted">rclone</span><b :class="status.tools.rclone ? 'ok' : 'err'">{{ status.tools.rclone ? '✓' : '✗' }}</b></div>
        <div class="status-row"><span class="muted">mesio</span><b :class="status.tools.mesio ? 'ok' : 'err'">{{ status.tools.mesio ? '✓' : '✗' }}</b></div>
        <div class="status-row"><span class="muted">录播姬</span><b :class="status.tools.bililive ? 'ok' : 'err'">{{ status.tools.bililive ? '✓' : '✗' }}</b></div>
      </div>
    </div>

    <div class="actions" style="margin-top:14px">
      <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
      <button class="btn" @click="restartMonitor">重启监控</button>
      <button class="btn btn-danger" @click="reset">恢复默认</button>
    </div>
  </div>
  <div v-else class="card empty">加载中…</div>
</template>

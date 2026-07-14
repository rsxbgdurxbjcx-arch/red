<script setup lang="ts">
import { onMounted, onUnmounted, ref, nextTick } from 'vue';
import { api, mediaUrl } from '../api';
import { useToast } from '../toast';
import { STATUS_LABELS, formatBytes, formatTime } from '../format';
import type { RecordingFile } from '../types';

const toast = useToast();
const list = ref<RecordingFile[]>([]);
const loading = ref(false);
const preview = ref<RecordingFile | null>(null);
const playerEl = ref<HTMLVideoElement | null>(null);
const refreshing = ref(false);
let timer: number | undefined;

async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    list.value = await api.listFiles();
  } catch (e) {
    if (!silent) toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function onRefresh() {
  refreshing.value = true;
  await load(true);
}

async function syncDisk() {
  try {
    list.value = await api.syncFiles();
    toast.success('已同步');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function remove(f: RecordingFile) {
  if (!confirm(`删除本地文件「${f.filename}」？`)) return;
  try {
    await api.deleteFile(f.id);
    toast.success('已删除');
    if (preview.value?.id === f.id) { preview.value = null; }
    await load(true);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function upload(f: RecordingFile) {
  if (f.status === 'recording' || f.status === 'processing') return;
  try {
    toast.info('正在上传...');
    const updated = await api.uploadFile(f.id);
    const idx = list.value.findIndex((x) => x.id === f.id);
    if (idx >= 0 && updated) list.value[idx] = updated;
    toast.success('上传完成');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

function canPlay(f: RecordingFile) {
  if (f.status === 'recording') return false;
  if (!f.absolutePath) return false;
  return /\.(mp4|webm|mkv|ts)$/i.test(f.filename);
}

function openPreview(f: RecordingFile) {
  if (!canPlay(f)) return;
  preview.value = f;
  nextTick(() => playerEl.value?.play().catch(() => undefined));
}

// 下拉刷新
let touchY = 0;
function onTS(e: TouchEvent) { if (window.scrollY === 0) touchY = e.touches[0].clientY; }
function onTE(e: TouchEvent) {
  if (window.scrollY === 0 && touchY > 0) {
    if (e.changedTouches[0].clientY - touchY > 80 && !refreshing.value) onRefresh();
  }
  touchY = 0;
}

onMounted(() => {
  void load();
  timer = window.setInterval(() => void load(true), 10000);
  document.addEventListener('touchstart', onTS, { passive: true });
  document.addEventListener('touchend', onTE, { passive: true });
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
  document.removeEventListener('touchstart', onTS);
  document.removeEventListener('touchend', onTE);
});
</script>

<template>
  <div>
    <div class="toolbar">
      <button class="btn btn-sm" :disabled="loading" @click="load()">{{ loading ? '...' : '刷新' }}</button>
      <button class="btn btn-sm" @click="syncDisk">同步磁盘</button>
      <span v-if="refreshing" class="refresh-hint">刷新中…</span>
      <span class="muted" style="margin-left:auto">{{ list.length }} 个文件</span>
    </div>

    <!-- 播放器 -->
    <div v-if="preview" class="card" style="margin-bottom:12px;position:sticky;top:66px;z-index:5">
      <div class="row space" style="margin-bottom:8px">
        <div class="item-title">▶ {{ preview.filename }}</div>
        <button class="btn btn-sm" @click="preview = null">关闭</button>
      </div>
      <video
        v-if="preview.absolutePath"
        ref="playerEl"
        class="player"
        controls
        playsinline
        webkit-playsinline
        :src="mediaUrl(preview.relativePath)"
      />
      <div v-else class="empty">本地文件已被移动或删除</div>
    </div>

    <div v-if="loading && !list.length" class="list">
      <div v-for="i in 3" :key="i" class="sk-card" />
    </div>

    <div v-else-if="!list.length" class="card empty">暂无录制文件</div>

    <div v-else class="list">
      <div v-for="f in list" :key="f.id" class="card">
        <div class="row space wrap">
          <div class="item-title">{{ f.filename }}</div>
          <span class="badge" :class="f.status">{{ STATUS_LABELS[f.status] || f.status }}</span>
        </div>
        <div class="item-sub">
          👤 {{ f.streamerName }} · 📦 {{ formatBytes(f.size) }} · {{ f.format.toUpperCase() }}
        </div>
        <div class="item-sub">🕒 {{ formatTime(f.createdAt) }}</div>
        <div class="item-sub" v-if="f.remotePath" style="color:#86efac">☁ {{ f.remotePath }}</div>
        <div class="item-sub" v-if="f.error" style="color:#fca5a5">⚠ {{ f.error }}</div>
        <div class="actions">
          <button class="btn btn-sm" :disabled="!canPlay(f)" @click="openPreview(f)">播放</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="f.status === 'recording' || f.status === 'processing'"
            @click="upload(f)"
          >
            上传 PikPak
          </button>
          <button class="btn btn-sm btn-danger" @click="remove(f)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.refresh-hint {
  color: var(--muted);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.refresh-hint::before {
  content: '';
  width: 14px; height: 14px;
  border: 2px solid var(--line);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { api } from '../api';
import { useToast } from '../toast';
import { STATUS_LABELS, formatTime } from '../format';
import type { Streamer } from '../types';

const toast = useToast();
const list = ref<Streamer[]>([]);
const loading = ref(false);
const modalOpen = ref(false);
const submitting = ref(false);
const editing = ref<Streamer | null>(null);
const imgFailed = ref<Record<string, boolean>>({});
const refreshing = ref(false);
let timer: number | undefined;

const form = ref({
  profileUrl: '',
  name: '',
  redId: '',
  roomId: '',
  enabled: true,
  downloader: 'global' as 'global' | 'ffmpeg' | 'mesio' | 'bililive',
});

const hasStreamers = computed(() => list.value.length > 0);

async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    list.value = await api.listStreamers();
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

function openAdd() {
  editing.value = null;
  form.value = { profileUrl: '', name: '', redId: '', roomId: '', enabled: true, downloader: 'global' };
  modalOpen.value = true;
}

function openEdit(s: Streamer) {
  editing.value = s;
  form.value = {
    profileUrl: s.profileUrl, name: s.name, redId: s.redId || '', roomId: s.roomId || '',
    enabled: s.enabled, downloader: s.downloader,
  };
  modalOpen.value = true;
}

async function save() {
  if (!form.value.profileUrl.trim()) { toast.warn('请填写主页/直播链接'); return; }
  submitting.value = true;
  try {
    const body = {
      profileUrl: form.value.profileUrl.trim(),
      name: form.value.name.trim() || undefined,
      redId: form.value.redId.trim() || null,
      roomId: form.value.roomId.trim() || null,
      enabled: form.value.enabled,
      downloader: form.value.downloader,
    };
    if (editing.value) {
      await api.updateStreamer(editing.value.id, body);
      toast.success('已更新');
    } else {
      await api.createStreamer(body);
      toast.success('已添加');
    }
    modalOpen.value = false;
    await load(true);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    submitting.value = false;
  }
}

async function remove(s: Streamer) {
  if (!confirm(`确认删除主播「${s.name}」？`)) return;
  try {
    await api.deleteStreamer(s.id);
    toast.success('已删除');
    await load(true);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function check(s: Streamer) {
  try {
    const updated = await api.checkStreamer(s.id);
    const idx = list.value.findIndex((x) => x.id === s.id);
    if (idx >= 0 && updated) list.value[idx] = updated;
    toast.success(`${updated?.name || s.name}: ${statusText(updated?.status || s.status)}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function stopRec(s: Streamer) {
  try {
    // 乐观更新：立即将状态改为离线
    const idx = list.value.findIndex((x) => x.id === s.id);
    if (idx >= 0) list.value[idx] = { ...s, status: 'offline' };
    const r = await api.stopStreamer(s.id);
    toast.info(r.stopped ? '已停止录制' : '当前未在录制');
    await load(true);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function startRec(s: Streamer) {
  try {
    const updated = await api.startStreamer(s.id);
    const idx = list.value.findIndex((x) => x.id === s.id);
    if (idx >= 0 && updated) list.value[idx] = updated;
    toast.success('已触发检测/开录');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function toggleEnabled(s: Streamer) {
  try {
    const updated = await api.updateStreamer(s.id, { enabled: !s.enabled });
    const idx = list.value.findIndex((x) => x.id === s.id);
    if (idx >= 0 && updated) list.value[idx] = updated;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

function statusText(s: string) { return STATUS_LABELS[s] || s; }

// 下拉刷新触摸
let touchStartY = 0;
function onTouchStart(e: TouchEvent) {
  if (window.scrollY === 0) touchStartY = e.touches[0].clientY;
}
function onTouchEnd(e: TouchEvent) {
  if (window.scrollY === 0 && touchStartY > 0) {
    const diff = e.changedTouches[0].clientY - touchStartY;
    if (diff > 80 && !refreshing.value) onRefresh();
  }
  touchStartY = 0;
}

onMounted(() => {
  void load();
  timer = window.setInterval(() => void load(true), 8000);
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
  document.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchend', onTouchEnd);
});
</script>

<template>
  <div>
    <div class="toolbar">
      <button class="btn btn-primary" @click="openAdd">＋ 添加主播</button>
      <button class="btn btn-sm" :disabled="loading" @click="load()">
        {{ loading ? '加载中…' : '刷新' }}
      </button>
      <div v-if="refreshing" class="refresh-hint">刷新中…</div>
    </div>

    <div v-if="loading && !hasStreamers" class="list">
      <div v-for="i in 3" :key="i" class="sk-card" />
    </div>

    <div v-else-if="!hasStreamers" class="card empty">
      暂无主播。请添加小红书主页或直播分享链接。
      <div class="muted" style="margin-top:8px">
        建议在「设置」填写 Cookie（含 a1 / web_session），才能自动发现每场变化的 roomId。
      </div>
    </div>

    <div v-else class="list">
      <div v-for="s in list" :key="s.id" class="card">
        <div class="item">
          <img
            v-if="s.avatar && !imgFailed[s.id]"
            class="avatar"
            :src="s.avatar"
            alt=""
            referrerpolicy="no-referrer"
            @error="imgFailed[s.id] = true"
          />
          <div v-else class="avatar placeholder">{{ (s.name || '?').slice(0, 1) }}</div>

          <div class="item-main">
            <div class="row space wrap">
              <div class="item-title">{{ s.name }}</div>
              <span class="badge" :class="s.status">{{ statusText(s.status) }}</span>
            </div>
            <div class="item-sub" v-if="s.title">📺 {{ s.title }}</div>
            <div class="item-sub url-text" :title="s.profileUrl">🔗 {{ s.profileUrl }}</div>
            <div class="item-sub">
              redId: <b>{{ s.redId || '-' }}</b> · roomId: <b>{{ s.roomId || '-' }}</b>
            </div>
            <div class="item-sub" v-if="s.lastError" style="color:#fca5a5">⚠ {{ s.lastError }}</div>
            <div class="item-sub" v-if="s.lastCheckedAt">🕒 {{ formatTime(s.lastCheckedAt) }}</div>

            <div class="actions">
              <button class="btn btn-sm" @click="check(s)">检查</button>
              <button class="btn btn-sm btn-primary" @click="startRec(s)">开录</button>
              <button class="btn btn-sm" :disabled="s.status !== 'recording'" @click="stopRec(s)">
                停录
              </button>
              <button class="btn btn-sm" @click="openEdit(s)">编辑</button>
              <button class="btn btn-sm" @click="toggleEnabled(s)">
                {{ s.enabled ? '禁用' : '启用' }}
              </button>
              <button class="btn btn-sm btn-danger" @click="remove(s)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="modalOpen" class="modal-mask" @click.self="modalOpen = false">
          <div class="modal">
            <div class="modal-head">
              <h3>{{ editing ? '编辑主播' : '添加主播' }}</h3>
              <button class="icon-btn" @click="modalOpen = false">✕</button>
            </div>
            <div class="field">
              <label class="label">主页 / 直播 / 分享链接 *</label>
              <input v-model="form.profileUrl" class="input" placeholder="小红书链接…" />
            </div>
            <div class="field">
              <label class="label">显示名称（可选）</label>
              <input v-model="form.name" class="input" placeholder="自动解析" />
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="label">小红书号 redId</label>
                <input v-model="form.redId" class="input" placeholder="自动解析优先" />
              </div>
              <div class="field">
                <label class="label">roomId</label>
                <input v-model="form.roomId" class="input" placeholder="每场会变化" />
              </div>
            </div>
            <div class="field">
              <label class="label">下载器</label>
              <select v-model="form.downloader" class="select">
                <option value="global">跟随全局</option>
                <option value="ffmpeg">FFmpeg</option>
                <option value="mesio">mesio</option>
                <option value="bililive">录播姬</option>
              </select>
            </div>
            <div class="switch">
              <div><div>启用监控</div><div class="muted">关闭后跳过自动轮询</div></div>
              <label class="toggle">
                <input v-model="form.enabled" type="checkbox" /><span class="slider" />
              </label>
            </div>
            <div class="actions" style="margin-top:16px">
              <button class="btn btn-primary" :disabled="submitting" @click="save">
                {{ submitting ? '保存中…' : '保存' }}
              </button>
              <button class="btn" @click="modalOpen = false">取消</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
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

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api';
import { useToast } from '../toast';
import { STATUS_LABELS, TRIGGER_LABELS, formatTime } from '../format';
import type { PostProcessJob } from '../types';

const toast = useToast();
const jobs = ref<PostProcessJob[]>([]);
const saving = ref(false);
const logJob = ref<PostProcessJob | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const configLoaded = ref(false);

const form = ref({
  postProcessScript: '',
  postProcessOnStreamEnd: true,
  postProcessOnManualStop: true,
  postProcessOnSegment: true,
  rcloneRemote: 'pikpak',
  rcloneRemotePath: 'red',
  rcloneMode: 'move' as 'move' | 'copy',
  rcloneDeleteLocalOnMove: true,
});

let timer: number | undefined;

async function loadConfig() {
  try {
    const cfg = await api.getPostConfig();
    const d = (cfg || {}) as Record<string, unknown>;
    form.value = {
      postProcessScript: String(d.postProcessScript || ''),
      postProcessOnStreamEnd: Boolean(d.postProcessOnStreamEnd),
      postProcessOnManualStop: Boolean(d.postProcessOnManualStop),
      postProcessOnSegment: Boolean(d.postProcessOnSegment),
      rcloneRemote: String(d.rcloneRemote || 'pikpak'),
      rcloneRemotePath: String(d.rcloneRemotePath || 'red'),
      rcloneMode: (d.rcloneMode as 'move' | 'copy') || 'move',
      rcloneDeleteLocalOnMove: d.rcloneDeleteLocalOnMove === undefined ? true : Boolean(d.rcloneDeleteLocalOnMove),
    };
    configLoaded.value = true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

async function loadJobs(silent = false) {
  if (!silent) loading.value = true;
  try {
    jobs.value = await api.listJobs() || [];
  } catch (e) {
    if (!silent) toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function load(silent = false) {
  if (!configLoaded.value) await loadConfig();
  await loadJobs(silent);
}

async function saveConfig() {
  saving.value = true;
  try {
    await api.savePostConfig({ ...form.value });
    toast.success('配置已保存');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

async function copyLog() {
  if (!logJob.value?.log) { toast.warn('无日志内容'); return; }
  try {
    await navigator.clipboard.writeText(logJob.value.log);
    toast.success('日志已复制');
  } catch {
    toast.error('复制失败，请手动选择复制');
  }
}

// 下拉刷新
let touchY = 0;
function onTS(e: TouchEvent) { if (window.scrollY === 0) touchY = e.touches[0].clientY; }
function onTE(e: TouchEvent) {
  if (window.scrollY === 0 && touchY > 0) {
    if (e.changedTouches[0].clientY - touchY > 80 && !refreshing.value) { refreshing.value = true; load(true); }
  }
  touchY = 0;
}

onMounted(() => {
  void load();
  timer = window.setInterval(() => void load(true), 8000);
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
    <div class="card stack">
      <div class="row space">
        <div class="item-title">后处理配置</div>
        <button class="btn btn-sm" :disabled="loading" @click="load()">刷新</button>
      </div>

      <div class="switch">
        <div><div>下播时触发</div><div class="muted">直播结束 / 流中断收尾</div></div>
        <label class="toggle"><input v-model="form.postProcessOnStreamEnd" type="checkbox" /><span class="slider" /></label>
      </div>
      <div class="switch">
        <div><div>手动暂停时触发</div><div class="muted">点击停录后上传当前片段</div></div>
        <label class="toggle"><input v-model="form.postProcessOnManualStop" type="checkbox" /><span class="slider" /></label>
      </div>
      <div class="switch">
        <div><div>达到时长切片时触发</div><div class="muted">每段录制完成后立即上传</div></div>
        <label class="toggle"><input v-model="form.postProcessOnSegment" type="checkbox" /><span class="slider" /></label>
      </div>

      <div class="grid-2">
        <div class="field">
          <label class="label">rclone 远程名</label>
          <input v-model="form.rcloneRemote" class="input" placeholder="pikpak" />
        </div>
        <div class="field">
          <label class="label">网盘根目录</label>
          <input v-model="form.rcloneRemotePath" class="input" placeholder="red" />
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label class="label">rclone 模式</label>
          <select v-model="form.rcloneMode" class="select">
            <option value="move">move（上传后删除本地）</option>
            <option value="copy">copy（保留本地）</option>
          </select>
        </div>
        <div class="field">
          <label class="label">移出后删除本地</label>
          <div class="switch" style="padding:0;border:0;margin-top:2px">
            <div class="muted">rclone move 失败时兜底</div>
            <label class="toggle">
              <input v-model="form.rcloneDeleteLocalOnMove" type="checkbox" :disabled="form.rcloneMode !== 'move'" />
              <span class="slider" />
            </label>
          </div>
        </div>
      </div>

      <div class="field">
        <label class="label">后处理脚本（sh）</label>
        <textarea v-model="form.postProcessScript" class="textarea" spellcheck="false" />
        <div class="muted" style="margin-top:6px">
          env: <code>RED_FILE_PATH</code> <code>RED_STREAMER</code> <code>RED_RCLONE_MODE</code> …
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" :disabled="saving" @click="saveConfig">
          {{ saving ? '保存中…' : '保存配置' }}
        </button>
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="row space" style="margin-bottom:10px">
        <div class="item-title">任务记录</div>
        <span class="muted">{{ jobs.length }} 条</span>
      </div>
      <div v-if="!jobs.length" class="empty">暂无后处理任务</div>
      <div v-else class="list">
        <div v-for="j in jobs" :key="j.id" class="card" style="box-shadow:none">
          <div class="row space wrap">
            <div class="item-title" style="font-size:14px">{{ j.filename }}</div>
            <span class="badge" :class="j.status">{{ STATUS_LABELS[j.status] || j.status }}</span>
          </div>
          <div class="item-sub">
            👤 {{ j.streamerName }} · {{ TRIGGER_LABELS[j.trigger] || j.trigger }} · 🕒 {{ formatTime(j.createdAt) }}
          </div>
          <div class="actions">
            <button class="btn btn-sm" @click="logJob = j">日志</button>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="logJob" class="modal-mask" @click.self="logJob = null">
          <div class="modal">
            <div class="modal-head">
              <h3>任务日志</h3>
              <button class="icon-btn" @click="logJob = null">✕</button>
            </div>
            <div class="item-sub" style="margin-bottom:8px">{{ logJob.filename }} · {{ STATUS_LABELS[logJob.status] }}</div>
            <pre class="log-pre">{{ logJob.log || '(空)' }}</pre>
            <div class="actions" style="margin-top:12px">
              <button class="btn btn-sm btn-primary" @click="copyLog">复制日志</button>
              <button class="btn btn-sm" @click="logJob = null">关闭</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

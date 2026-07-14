<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from './api';
import type { SystemStatus } from './types';
import { formatBytes } from './format';
import Toast from './Toast.vue';

const route = useRoute();
const status = ref<SystemStatus | null>(null);
let timer: number | undefined;

const title = computed(() => (route.meta.title as string) || 'red');

async function refreshStatus() {
  try {
    status.value = await api.status();
  } catch { /* ignore */ }
}

onMounted(() => {
  void refreshStatus();
  timer = window.setInterval(() => void refreshStatus(), 6000);
});

onUnmounted(() => { if (timer) window.clearInterval(timer); });
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo">R</div>
        <div>
          <div class="brand-title">red</div>
          <div class="brand-sub">小红书直播录制</div>
        </div>
      </div>
      <div class="top-stats" v-if="status">
        <span class="pill"><span class="dot dot-rec" />{{ status.recordingCount }}</span>
        <span class="pill"><span class="dot dot-online" />{{ status.onlineCount }}/{{ status.streamerCount }}</span>
        <span class="pill hide-sm">{{ formatBytes(status.diskRecordingsBytes) }}</span>
      </div>
    </header>

    <main class="page">
      <div class="page-head">
        <h1>{{ title }}</h1>
      </div>
      <router-view v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </main>

    <nav class="tabbar">
      <router-link to="/streamers" class="tab" v-slot="{ isActive }">
        <span class="tab-ico" :class="{ active: isActive }">主</span>
        <span :class="{ active: isActive }">主播</span>
      </router-link>
      <router-link to="/files" class="tab" v-slot="{ isActive }">
        <span class="tab-ico" :class="{ active: isActive }">档</span>
        <span :class="{ active: isActive }">文件</span>
      </router-link>
      <router-link to="/postprocess" class="tab" v-slot="{ isActive }">
        <span class="tab-ico" :class="{ active: isActive }">传</span>
        <span :class="{ active: isActive }">后处理</span>
      </router-link>
      <router-link to="/settings" class="tab" v-slot="{ isActive }">
        <span class="tab-ico" :class="{ active: isActive }">设</span>
        <span :class="{ active: isActive }">设置</span>
      </router-link>
    </nav>

    <Toast />
  </div>
</template>

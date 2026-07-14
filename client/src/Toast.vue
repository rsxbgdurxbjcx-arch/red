<script setup lang="ts">
import { useToast } from './toast';

const { list, dismiss } = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="toast-stack">
      <TransitionGroup name="toast">
        <div v-for="t in list" :key="t.id" class="toast-card" :class="['toast-' + t.type]" @click="dismiss(t.id)">
          <span class="toast-dot" />
          <span class="toast-text">{{ t.text }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  width: min(92vw, 420px);
}
.toast-card {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(26, 26, 26, 0.96);
  border: 1px solid #444;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  font-size: 14px;
  cursor: pointer;
  user-select: none;
  color: #ffffff;
}
.toast-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.toast-text { flex: 1; word-break: break-word; }
.toast-info .toast-dot { background: var(--info); }
.toast-success .toast-dot { background: var(--ok); }
.toast-warn .toast-dot { background: var(--warn); }
.toast-error .toast-dot { background: var(--err); }

.toast-enter-active,
.toast-leave-active { transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.toast-enter-from { opacity: 0; transform: translateY(-12px) scale(0.96); }
.toast-leave-to { opacity: 0; transform: translateY(-8px) scale(0.96); }
</style>

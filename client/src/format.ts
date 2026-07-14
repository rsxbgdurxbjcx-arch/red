export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleString();
}

export const STATUS_LABELS: Record<string, string> = {
  offline: '离线',
  online: '在线',
  recording: '录制中',
  parse_error: '解析失败',
  unknown: '未知',
  ready: '就绪',
  processing: '处理中',
  uploaded: '已上传',
  error: '错误',
  pending: '等待',
  running: '运行中',
  success: '成功',
  failed: '失败',
};

export const TRIGGER_LABELS: Record<string, string> = {
  stream_end: '下播',
  manual_stop: '手动暂停',
  segment: '切片',
  manual: '手动',
};

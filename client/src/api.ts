import type {
  ApiResponse,
  RecordingFile,
  Settings,
  Streamer,
  SystemStatus,
  PostProcessJob,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      ...init,
    });
  } catch (e) {
    throw new Error(`网络错误: ${(e as Error).message}`);
  }

  let data: ApiResponse<T>;
  try {
    data = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`服务器响应无效 (HTTP ${res.status})`);
  }

  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || `HTTP ${res.status}`);
  }
  return data.data as T;
}

export const api = {
  status: () => request<SystemStatus>('/api/system/status'),
  restartMonitor: () => request<unknown>('/api/system/monitor/restart', { method: 'POST' }),

  listStreamers: () => request<Streamer[]>('/api/streamers'),
  getStreamer: (id: string) => request<Streamer>(`/api/streamers/${id}`),
  createStreamer: (body: {
    profileUrl: string;
    name?: string;
    enabled?: boolean;
    downloader?: string;
    redId?: string | null;
    roomId?: string | null;
  }) => request<Streamer>('/api/streamers', { method: 'POST', body: JSON.stringify(body) }),
  updateStreamer: (id: string, body: Record<string, unknown>) =>
    request<Streamer>(`/api/streamers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteStreamer: (id: string) => request<unknown>(`/api/streamers/${id}`, { method: 'DELETE' }),
  checkStreamer: (id: string) => request<Streamer>(`/api/streamers/${id}/check`, { method: 'POST' }),
  stopStreamer: (id: string) => request<{ stopped: boolean }>(`/api/streamers/${id}/stop`, { method: 'POST' }),
  startStreamer: (id: string) => request<Streamer>(`/api/streamers/${id}/start`, { method: 'POST' }),

  listFiles: () => request<RecordingFile[]>('/api/files'),
  deleteFile: (id: string) => request<unknown>(`/api/files/${id}`, { method: 'DELETE' }),
  uploadFile: (id: string) => request<RecordingFile>(`/api/files/${id}/upload`, { method: 'POST' }),
  syncFiles: () => request<RecordingFile[]>('/api/files/sync', { method: 'POST' }),

  getPostConfig: () => request<Record<string, unknown>>('/api/postprocess/config'),
  savePostConfig: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/postprocess/config', { method: 'PUT', body: JSON.stringify(body) }),
  listJobs: () => request<PostProcessJob[]>('/api/postprocess/jobs'),
  runPost: (fileId: string) => request<unknown>(`/api/postprocess/run/${fileId}`, { method: 'POST' }),

  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (body: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  resetSettings: () => request<Settings>('/api/settings/reset', { method: 'POST' }),
};

export function mediaUrl(relativePath: string) {
  return `/media/${String(relativePath).split('/').map(encodeURIComponent).join('/')}`;
}

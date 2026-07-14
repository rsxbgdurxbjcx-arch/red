import { createRouter, createWebHistory } from 'vue-router';
import StreamersView from './views/StreamersView.vue';
import FilesView from './views/FilesView.vue';
import PostProcessView from './views/PostProcessView.vue';
import SettingsView from './views/SettingsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/streamers' },
    { path: '/streamers', component: StreamersView, meta: { title: '主播' } },
    { path: '/files', component: FilesView, meta: { title: '文件' } },
    { path: '/postprocess', component: PostProcessView, meta: { title: '后处理' } },
    { path: '/settings', component: SettingsView, meta: { title: '设置' } },
  ],
});

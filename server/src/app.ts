import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.js';
import { streamersRouter } from './routes/streamers.js';
import { filesRouter, resolveMediaPath } from './routes/files.js';
import { postprocessRouter } from './routes/postprocess.js';
import { settingsRouter } from './routes/settings.js';
import { systemRouter } from './routes/system.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // -- API 路由（优先级最高）--
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, message: 'red ok', version: '1.0.0' });
  });

  app.use('/api/streamers', streamersRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/postprocess', postprocessRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/system', systemRouter);

  // -- 媒体预览 --
  app.get('/media/:filePath(*)', (req, res) => {
    const rel = String(req.params.filePath || '').replace(/^\/+/, '');
    if (!rel) {
      res.status(400).json({ ok: false, error: '缺少文件路径' });
      return;
    }
    const abs = resolveMediaPath(rel);
    if (!abs) {
      res.status(404).json({ ok: false, error: '文件不存在' });
      return;
    }
    res.sendFile(abs);
  });

  // -- 静态文件 + SPA --
  const distDir = PATHS.clientDist;
  const indexPath = path.join(distDir, 'index.html');
  const hasClient = fs.existsSync(indexPath);

  console.log(`[app] clientDist=${distDir} hasClient=${hasClient}`);

  if (hasClient) {
    // 所有非 API / 非 media 请求 → 优先匹配静态文件
    app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));

    // SPA 回退（客户端路由如 /streamers /files 等）
    app.get(/^\/(?!api|media).*/, (req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    app.get(/^\/(?!api|media).*/, (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>red</title><style>body{background:#f8f9fa;color:#1a1a1a;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column}
a{color:#1a1a1a}h2{margin:0 0 8px}p{color:#888;font-size:14px}</style></head>
<body><h2>red server running</h2><p>前端未构建。请运行 <code>npm run build -w client</code> 或使用 <code>npm run dev:client</code>。</p>
<p>API 端点：<a href="/api/health">/api/health</a></p></body></html>`);
    });
  }

  // -- 错误处理 --
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('[error]', err);
      res.status(500).json({ ok: false, error: err.message || '服务器错误' });
    },
  );

  return app;
}

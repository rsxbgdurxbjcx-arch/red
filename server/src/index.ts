import fs from 'node:fs';
import { createApp } from './app.js';
import {
  HOST,
  PORT,
  PATHS,
  ensureDirs,
  loadSettings,
} from './config.js';
import { getDb, syncFilesFromDisk } from './db/index.js';
import { monitorService } from './services/monitor.js';
import { recorderService } from './services/recorder.js';

async function main() {
  ensureDirs();
  getDb();
  const settings = loadSettings();
  syncFilesFromDisk(settings.recordingsDir);

  console.log(`[red] ROOT=${PATHS.root}`);
  console.log(`[red] clientDist=${PATHS.clientDist}`);
  console.log(`[red] clientDist exists=${fs.existsSync(PATHS.clientDist)}`);
  if (fs.existsSync(PATHS.clientDist)) {
    console.log(`[red] clientDist files: ${fs.readdirSync(PATHS.clientDist).join(', ')}`);
  }

  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`[red] listening on http://${HOST}:${PORT}`);
    console.log(`[red] data=${PATHS.data}`);
    console.log(`[red] recordings=${PATHS.recordings}`);
    console.log(
      `[red] downloader=${settings.downloader} poll=${settings.pollIntervalSec}s segment=${settings.segmentDuration}`,
    );
  });

  monitorService.start();

  const shutdown = async (signal: string) => {
    console.log(`[red] received ${signal}, shutting down...`);
    monitorService.stop();
    await recorderService.stopAll('manual_stop');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

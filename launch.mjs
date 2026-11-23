import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVideoServer } from './video/server.mjs';

const root = dirname(fileURLToPath(import.meta.url));
let assetsRoot = root;
try {
  await access(join(root, 'worker-source.js'));
} catch {
  assetsRoot = join(root, 'dist', 'red-light-corrector');
}

try {
  await access(join(assetsRoot, 'worker-source.js')).catch(() => {
    throw new Error('Build the offline package first with node packaging/build.mjs.');
  });
  const port = Number(process.env.RLC_VIDEO_PORT || '18749');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Set RLC_VIDEO_PORT to a port from 1024 to 65535.');
  const app = await startVideoServer({
    assetsRoot, port, ffmpeg: process.env.RLC_FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.RLC_FFPROBE_PATH || 'ffprobe',
  });
  console.log('Open ' + app.origin + '/video.html in Chrome. Press Ctrl+C to close.');
  const stop = async () => {
    try {
      await app.stop();
    } catch {
      console.error('Could not remove all temporary files. Check the system temporary folder.');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? 'The local port is in use. Close the other launcher or set RLC_VIDEO_PORT.' : error.message);
  process.exitCode = 1;
}

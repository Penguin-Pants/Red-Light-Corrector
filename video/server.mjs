import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { checkTools, encode, outputNotes, probe, settings } from './transcode.mjs';

const maxInput = 8 * 1024 ** 3;
const maxStored = 32 * 1024 ** 3;
const assets = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/video.html', 'video.html'],
  ['/styles.css', 'styles.css'],
  ['/video.css', 'video.css'],
  ['/decoder-source.js', 'decoder-source.js'],
  ['/worker-source.js', 'worker-source.js'],
  ...['app.js', 'metadata.js', 'presets.js', 'zip.js'].map((file) => ['/src/' + file, 'src/' + file]),
  ['/video/app.js', 'video/app.js'],
]);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function serveFile(req, res, path, type, { ranges = false, attachment = false } = {}) {
  const { size } = await stat(path);
  const headers = { 'Content-Type': type, 'Content-Length': size };
  if (attachment) headers['Content-Disposition'] = 'attachment';
  if (ranges) headers['Accept-Ranges'] = 'bytes';

  let start = 0;
  let end = size - 1;
  let status = 200;
  if (ranges && req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (match?.[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    } else if (match?.[2]) start = Math.max(0, size - Number(match[2]));
    if (!match || (!match[1] && Number(match[2]) <= 0) || !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size });
      res.end();
      return;
    }
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    headers['Content-Length'] = end - start + 1;
    status = 206;
  }

  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  await pipeline(createReadStream(path, { start, end }), res);
}

export async function startVideoServer({
  assetsRoot, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', tempRoot = tmpdir(), port = 0,
}) {
  await checkTools(ffmpeg, ffprobe);
  const workspace = await mkdtemp(join(tempRoot, 'red-light-video-'));
  const results = new Map();
  let stored = 0;
  let active = null;
  let host;
  let origin;
  let closing;

  async function processVideo(req, res, preview) {
    if (active) return json(res, 409, { error: 'One video is already running. Wait for it or cancel it.' });
    const size = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(size) || size < 1 || size > maxInput) {
      return json(res, 413, { error: 'Choose a video file between 1 byte and 8 GiB.' });
    }
    let correction;
    try {
      correction = settings(JSON.parse(req.headers['x-rlc-settings'] || '{}'));
    } catch {
      return json(res, 400, { error: 'Invalid correction settings.' });
    }
    if (stored >= maxStored) return json(res, 507, { error: 'Clear the prepared exports before continuing.' });
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(4 * 60 * 60 * 1000)]);
    const id = randomUUID();
    const directory = join(workspace, id);
    const input = join(directory, 'source.mov');
    let response;
    let status;
    let retained = false;
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    active = { controller, done };
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', cancel);
    try {
      await mkdir(directory);
      await pipeline(req, createWriteStream(input, { flags: 'wx' }), { signal });
      const info = await probe(ffprobe, input, signal);
      const start = Math.min(correction.start, Math.max(0, info.duration - 0.05));
      const output = join(directory, 'corrected.mp4');
      if (preview) {
        await encode(ffmpeg, input, join(directory, 'original.mp4'), info, null, signal, { preview, start });
      }
      await encode(ffmpeg, input, output, info, correction, signal, { preview, start });
      await rm(input);
      const bytes = (await stat(output)).size + (preview ? (await stat(join(directory, 'original.mp4'))).size : 0);
      if (stored + bytes > maxStored) {
        status = 507;
        response = { error: 'There is insufficient room in the session export limit. Clear prepared exports.' };
        return;
      }
      signal.throwIfAborted();
      const base = '/api/media/' + id + '/';
      results.set(id, { directory, bytes, preview });
      stored += bytes;
      retained = true;
      status = 200;
      response = {
        id, original: preview ? base + 'original' : null, corrected: base + 'corrected',
        download: preview ? null : base + 'download', start, duration: info.duration, notes: outputNotes(info),
      };
    } catch (error) {
      if (!res.destroyed) {
        const message = signal.aborted ? 'Video processing stopped.' : error.code === 'ENOSPC'
          ? 'The temporary drive ran out of space.' : error.code
            ? 'The local video operation failed.' : error.message;
        status = signal.aborted ? 408 : 422;
        response = { error: message };
      }
    } finally {
      res.removeListener('close', cancel);
      try {
        if (!retained) await rm(directory, { recursive: true, force: true, maxRetries: 3 });
      } finally {
        active = null;
        resolveDone();
        if (response && !res.destroyed) json(res, status, response);
      }
    }
  }

  const server = createServer({ requestTimeout: 0 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src blob:; worker-src blob:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== host || !req.url?.startsWith('/') || req.url.startsWith('//')) {
      return json(res, 403, { error: 'Only the local app address is allowed.' });
    }

    const path = req.url.split('?', 1)[0];
    const write = req.method === 'POST' || req.method === 'DELETE';
    if (write && (req.headers.origin !== origin || req.headers['x-rlc-video'] !== '1')) {
      return json(res, 403, { error: 'Only the local video page can change this session.' });
    }

    try {
      if (req.method === 'POST' && (path === '/api/preview' || path === '/api/export')) {
        await processVideo(req, res, path.endsWith('preview'));
        return;
      }
      const media = /^\/api\/media\/([0-9a-f-]{36})(?:\/(original|corrected|download))?$/.exec(path);
      if (media) {
        const result = results.get(media[1]);
        if (!result) return json(res, 404, { error: 'This result is no longer available.' });
        if (req.method === 'DELETE' && !media[2]) {
          await rm(result.directory, { recursive: true, force: true });
          if (results.delete(media[1])) stored -= result.bytes;
          return json(res, 200, { removed: true });
        }
        if ((req.method === 'GET' || req.method === 'HEAD') && media[2]
            && (result.preview || media[2] !== 'original') && (!result.preview || media[2] !== 'download')) {
          const name = media[2] === 'original' ? 'original.mp4' : 'corrected.mp4';
          await serveFile(req, res, join(result.directory, name), 'video/mp4', { ranges: true, attachment: media[2] === 'download' });
          return;
        }
      }
      const asset = assets.get(path);
      if ((req.method === 'GET' || req.method === 'HEAD') && asset) {
        await serveFile(req, res, join(assetsRoot, asset), types[asset.split('.').pop()]);
        return;
      }
      json(res, 404, { error: 'Page not found.' });
    } catch {
      if (!res.headersSent && !res.destroyed) json(res, 500, { error: 'The local operation failed.' });
      else if (!res.destroyed) res.destroy();
    }
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
  host = '127.0.0.1:' + server.address().port;
  origin = 'http://' + host;
  return {
    origin,
    stop() {
      closing ||= (async () => {
        const job = active;
        job?.controller.abort();
        const closed = new Promise((resolve) => server.close(resolve));
        server.closeAllConnections();
        await Promise.all([closed, job?.done]);
        await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
      })();
      return closing;
    },
  };
}

'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { request } = require('node:http');
const { mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const { chromium } = require('playwright');
const exec = promisify(execFile);

async function test() {
  const root = await mkdtemp(join(tmpdir(), 'rlc-video-test-'));
  const work = join(root, 'sessions');
  await mkdir(work);
  const assetsRoot = resolve(__dirname, '../dist/red-light-corrector');
  const { startVideoServer } = await import(pathToFileURL(join(assetsRoot, 'video/server.mjs')));
  const source = join(root, 'red.mp4');
  const pcm = join(root, 'red.mov');
  const hdr = join(root, 'hdr.mp4');
  let server;
  let browser;
  try {
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xa83922:s=160x96:r=12',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '2', '-threads', '2',
      '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', source]);
    await exec('ffmpeg', ['-v', 'error', '-i', source, '-c:v', 'copy', '-c:a', 'pcm_s16le', pcm]);
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xa83922:s=160x96:r=12',
      '-t', '1', '-threads', '2', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
      '-x265-params', 'pools=none:frame-threads=1:log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
      '-movflags', '+write_colr', hdr]);
    server = await startVideoServer({ assetsRoot, tempRoot: work });
    const { origin } = server;
    const headers = { Origin: origin, 'X-RLC-Video': '1' };
    const body = await readFile(source);
    const rejected = await fetch(origin + '/api/export', { method: 'POST', body });
    assert.equal(rejected.status, 403);
    const bad = await fetch(origin + '/api/export', { method: 'POST', headers, body: Buffer.from('not a video') });
    assert.equal(bad.status, 422);

    const partial = request(origin + '/api/export', {
      method: 'POST', headers: { ...headers, 'Content-Length': 1024 * 1024 },
    });
    const disconnected = new Promise((resolve) => partial.once('close', resolve));
    partial.on('error', () => {});
    partial.write('partial');
    try {
      for (let i = 0; i < 50; i += 1) {
        const [session] = await readdir(work);
        if ((await readdir(join(work, session))).length) break;
        await delay(20);
      }
      const busy = await fetch(origin + '/api/export', { method: 'POST', headers, body });
      assert.equal(busy.status, 409);
    } finally {
      partial.destroy();
      await disconnected;
    }
    for (let i = 0; i < 50; i += 1) {
      const [session] = await readdir(work);
      if (!(await readdir(join(work, session))).length) break;
      await delay(20);
    }
    const [session] = await readdir(work);
    assert.deepEqual(await readdir(join(work, session)), []);

    async function prepare(name, action, options) {
      const response = await fetch(origin + '/api/' + action, {
        method: 'POST', headers: { ...headers, 'X-RLC-Settings': JSON.stringify(options) },
        body: await readFile(name),
      });
      const result = await response.json();
      assert.equal(response.status, 200, result.error);
      return result;
    }

    const preview = await prepare(source, 'preview', { red: -0.32, start: 0.5 });
    assert.equal(preview.start, 0.5);
    const part = await fetch(origin + preview.corrected, { headers: { Range: 'bytes=0-15' } });
    assert.equal(part.status, 206);
    assert.equal((await part.arrayBuffer()).byteLength, 16);
    const sampled = [];
    for (const key of ['original', 'corrected']) {
      const path = join(root, key + '-preview.mp4');
      const response = await fetch(origin + preview[key]);
      assert.equal(response.status, 200);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
      const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1',
        '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
      sampled.push(stdout[0]);
    }
    assert.ok(sampled[1] < sampled[0] - 8, 'The fixed correction reduces red in the preview.');

    async function download(result, name) {
      const path = join(root, name);
      const response = await fetch(origin + result.download);
      assert.match(response.headers.get('content-disposition'), /^attachment/);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
      return path;
    }

    const exported = await prepare(source, 'export', { red: -0.2 });
    assert.equal(exported.notes.copiedAudio, 1);
    const output = await download(exported, 'output.mp4');
    const audioSignatures = await Promise.all([source, output].map(async (path) => {
      const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_packets',
        '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'csv=p=0', path]);
      return stdout;
    }));
    assert.equal(audioSignatures[0], audioSignatures[1]);
    const converted = await prepare(pcm, 'export', {});
    assert.equal(converted.notes.convertedAudio, 1);
    const toneMapped = await prepare(hdr, 'export', {});
    assert.match(toneMapped.notes.color, /converted to SDR/);
    const hdrOutput = await download(toneMapped, 'hdr-sdr.mp4');
    const { stdout: transfer } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=color_transfer', '-of', 'csv=p=0', hdrOutput]);
    assert.equal(transfer.trim(), 'bt709');
    const clear = await fetch(origin + '/api/media/' + preview.id, { method: 'DELETE', headers });
    assert.equal(clear.status, 200);
    assert.equal((await fetch(origin + preview.corrected)).status, 404);

    browser = await chromium.launch({ executablePath: process.env.RLC_CHROMIUM_PATH });
    const context = await browser.newContext({ acceptDownloads: true });
    const requests = [];
    await context.route(/^https?:/i, (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      requests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByRole('link', { name: 'Video' }).click();
    await page.locator('#video-files').setInputFiles(source);
    const dropped = await page.evaluate((base64) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], 'red.mov', { type: 'video/quicktime' }));
      return !document.querySelector('.workspace').dispatchEvent(new DragEvent('drop', {
        dataTransfer: transfer, bubbles: true, cancelable: true,
      }));
    }, (await readFile(pcm)).toString('base64'));
    assert.equal(dropped, true);
    assert.equal(await page.locator('#videos li').count(), 2);
    await page.getByRole('button', { name: 'Select none' }).click();
    assert.equal(await page.locator('#videos input:checked').count(), 0);
    await page.getByRole('button', { name: 'Select all' }).click();
    assert.equal(await page.locator('#videos input:checked').count(), 2);
    await page.locator('#video-preset').selectOption('Balanced');
    await page.locator('#video-scope').selectOption('clip');
    await page.locator('#video-red').fill('-0.39');
    assert.match(await page.locator('#videos li').first().textContent(), /Override/);
    await page.getByRole('button', { name: 'Preview 8 seconds' }).click();
    await page.getByText('Preview ready.', { exact: true }).waitFor();
    assert.match(await page.locator('#video-original').getAttribute('src'), /\/original$/);
    assert.match(await page.locator('#video-corrected').getAttribute('src'), /\/corrected$/);
    await page.locator('#video-destination').selectOption('downloads');
    await page.getByRole('button', { name: 'Export checked' }).click();
    await page.getByText('2 videos ready to download, 0 failed.', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('#video-output a').allTextContents(), [
      'Download red_corrected.mp4', 'Download red_corrected_2.mp4',
    ]);
    const received = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download red_corrected.mp4', exact: true }).click();
    assert.equal((await received).suggestedFilename(), 'red_corrected.mp4');

    await page.evaluate(() => {
      window.folderWrites = [];
      window.showDirectoryPicker = async () => ({
        getDirectoryHandle: async () => ({
          async *keys() {},
          getFileHandle: async (name) => ({
            getFile: async () => new Blob([]),
            createWritable: async () => {
              let total = 0;
              return new WritableStream({
                write(chunk) { total += chunk.byteLength; },
                close() { window.folderWrites.push([name, total]); },
              });
            },
          }),
        }),
      });
    });
    await page.locator('#video-destination').selectOption('folder');
    await page.getByRole('button', { name: 'Export checked' }).click();
    await page.getByText('2 videos saved, 0 failed.', { exact: true }).waitFor();
    const folderWrites = await page.evaluate(() => window.folderWrites);
    assert.equal(folderWrites.length, 2);
    assert.ok(folderWrites.every(([, bytes]) => bytes > 0));
    await page.getByRole('button', { name: 'Clear videos' }).click();
    await page.getByText('Videos cleared.', { exact: true }).waitFor();
    assert.equal(await page.locator('#videos li').count(), 0);
    assert.deepEqual(await readFile(source), body);
    assert.deepEqual(requests, []);
  } finally {
    await browser?.close();
    await server?.stop();
    assert.deepEqual(await readdir(work), []);
    await rm(root, { recursive: true, force: true });
  }
}

test().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

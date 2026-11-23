'use strict';
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');

async function test() {
  const address = new URL(process.env.RLC_APP_URL || 'http://127.0.0.1:18748/index.html');
  assert.match(address.origin, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/);
  const root = await mkdtemp(join(tmpdir(), 'rlc-app-test-'));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.RLC_CHROMIUM_PATH });
    const context = await browser.newContext({ acceptDownloads: true });
    const attempted = [];
    await context.route(/^https?:/i, (route) => {
      if (new URL(route.request().url()).origin === address.origin) return route.continue();
      attempted.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(address.href);
    const images = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 56;
      const context = canvas.getContext('2d');
      context.fillStyle = '#bc482c';
      context.fillRect(0, 0, 96, 56);
      context.fillStyle = '#dd956c';
      context.fillRect(50, 0, 46, 56);
      return [canvas.toDataURL('image/jpeg'), canvas.toDataURL('image/png')].map((uri) => uri.split(',')[1]);
    });
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'test.jpg'), Buffer.from(images[0], 'base64'));
    await writeFile(join(root, 'nested', 'test.png'), Buffer.from(images[1], 'base64'));
    await writeFile(join(root, 'broken.jpg'), 'corrupt');
    await writeFile(join(root, 'nested', 'photo.heic'), await readFile(resolve(__dirname, '../feasibility/fixtures/metadata-icc.heic')));
    await page.locator('#folder').setInputFiles(root);
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Analysis complete.'), null, { timeout: 120000 });
    assert.match(await page.locator('#status').textContent(), /4 processed, 1 failed/);
    assert.equal(await page.locator('#photos li').count(), 4);
    assert.match(await page.locator('#photos li').filter({ hasText: 'photo.heic' }).innerText(), /confidence/);

    const png = page.getByRole('button', { name: /test\.png/ });
    await png.click();
    await page.locator('#corrected').waitFor({ state: 'visible' });
    assert.match(await page.locator('#confidence').textContent(), /Natural automatic confidence/);
    await page.locator('#mode').selectOption('Balanced');
    await page.locator('#exposure').fill('0.5');
    await page.getByRole('button', { name: 'Apply adjustments' }).click();
    assert.match(await page.locator('#status').textContent(), /Applied adjustments to 1 photos/);
    await page.getByText('Saved presets', { exact: true }).click();
    await page.locator('#preset-name').fill('Soft light');
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    assert.equal(await page.locator('#preset-status').textContent(), 'Preset saved.');

    await page.locator('#format').selectOption('image/png');
    await page.locator('[name="export-mode"][value="Balanced"]').check();
    await page.getByRole('button', { name: 'Export ZIP' }).click();
    const button = page.getByRole('button', { name: 'Download ZIP 1' });
    await button.waitFor();
    const downloadEvent = page.waitForEvent('download');
    await button.click();
    const download = await downloadEvent;
    const zipPath = process.env.RLC_TEST_ZIP;
    if (zipPath) await download.saveAs(zipPath);
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Export run complete.'));
    assert.match(await page.locator('#status').textContent(), /0 outputs failed/);
    assert.equal(await page.locator('#export-log li').count(), 6);
    assert.match(await page.locator('#export-log').textContent(), /test_natural_2\.png/);

    await page.locator('#format').selectOption('image/jpeg');
    await page.getByRole('button', { name: 'Export ZIP' }).click();
    await button.waitFor();
    const jpegEvent = page.waitForEvent('download');
    await button.click();
    const jpegZip = await jpegEvent;
    if (zipPath) await jpegZip.saveAs(zipPath + '.jpeg.zip');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Export run complete.'));
    assert.match(await page.locator('#status').textContent(), /0 outputs failed/);

    await page.evaluate(() => {
      window.savedOutput = [];
      window.showDirectoryPicker = async () => ({
        getDirectoryHandle: async () => ({
          async *keys() {},
          getFileHandle: async (name) => ({
            getFile: async () => new Blob([]),
            createWritable: async () => ({
              write: async (blob) => window.savedOutput.push([name, blob.size]),
              close: async () => {},
              abort: async () => {},
            }),
          }),
        }),
      });
    });
    await page.locator('#export-scope').selectOption('photo');
    await page.getByRole('button', { name: 'Save to folder' }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Export run complete.'));
    const writes = await page.evaluate(() => window.savedOutput);
    assert.deepEqual(writes.map(([name]) => name), ['test_natural.jpg', 'test_balanced.jpg']);
    assert.ok(writes.every(([, size]) => size > 0));

    await page.locator('#format').selectOption('image/png');
    await page.reload();
    assert.equal(await page.locator('#photos li').count(), 0);
    assert.equal(await page.locator('#presets option').count(), 1);
    assert.equal(await page.locator('#format').inputValue(), 'image/png');
    const drop = await page.evaluate((source) => {
      const dataTransfer = new DataTransfer();
      const bytes = Uint8Array.from(atob(source), (character) => character.charCodeAt(0));
      dataTransfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
      dataTransfer.items.add(new File(['ignore'], 'unsupported.txt', { type: 'text/plain' }));
      const target = document.querySelector('.exports');
      const send = (type) => !target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      const dragoverPrevented = send('dragover');
      const highlighted = document.documentElement.classList.contains('dragging-photos');
      const dropPrevented = send('drop');
      return { dragoverPrevented, highlighted, dropPrevented };
    }, images[1]);
    assert.deepEqual(drop, { dragoverPrevented: true, highlighted: true, dropPrevented: true });
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Analysis complete.'));
    assert.match(await page.locator('#status').textContent(), /1 processed, 0 failed.*unsupported files skipped/);
    assert.match(await page.locator('#photos li').textContent(), /dropped\.png.*confidence/);
    assert.equal(await page.locator('html.dragging-photos').count(), 0);
    await page.getByRole('button', { name: 'Clear photos' }).click();
    let batchBytes = Buffer.from(images[1], 'base64');
    let suffix = 'png';
    if (process.env.RLC_FULL_RES_TEST) {
      const encoded = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 4000;
        canvas.height = 3000;
        const context = canvas.getContext('2d');
        const ramp = context.createLinearGradient(0, 0, 4000, 3000);
        ramp.addColorStop(0, '#35140c');
        ramp.addColorStop(1, '#df9462');
        context.fillStyle = ramp;
        context.fillRect(0, 0, 4000, 3000);
        return canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
      });
      batchBytes = Buffer.from(encoded, 'base64');
      suffix = 'jpg';
    }
    const batch = Array.from({ length: 101 }, (_, index) => ({
      name: 'batch-' + String(index).padStart(3, '0') + '.' + suffix,
      mimeType: suffix === 'jpg' ? 'image/jpeg' : 'image/png',
      buffer: batchBytes,
    }));
    const browserRun = Date.now();
    await page.locator('#files').setInputFiles(batch);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Analysis cancelled.'));
    assert.match(await page.locator('#status').textContent(), /1 photos exceeded the 100-photo limit/);
    assert.equal(await page.locator('#photos li').count(), 100);
    await page.getByRole('button', { name: 'Retry unfinished' }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Analysis complete.'));
    assert.equal(await page.locator('#photos li').filter({ hasText: /confidence/ }).count(), 100);
    process.stdout.write('100-photo synthetic count, cancel and retry: ' + (Date.now() - browserRun) + ' ms\n');
    await page.getByRole('button', { name: 'Clear photos' }).click();
    assert.equal(await page.locator('#photos li').count(), 0);
    assert.deepEqual(attempted, []);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await rm(root, { force: true, recursive: true });
  }
}

test().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

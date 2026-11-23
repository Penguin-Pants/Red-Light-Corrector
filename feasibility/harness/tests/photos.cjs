'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function finished(page) {
  const status = page.locator('#heic-result');
  await page.waitForFunction(() => document.querySelector('#heic-result').textContent !== 'Decoding');
  return status.textContent();
}

async function test() {
  const decoder = process.env.RLC_HEIC_DECODER;
  assert.ok(decoder, 'Set RLC_HEIC_DECODER to the pinned classic JavaScript bundle');
  const fixtures = resolve(__dirname, '../../fixtures');
  const folder = await mkdtemp(join(tmpdir(), 'rlc-photos-'));
  let browser;
  try {
    await mkdir(join(folder, 'nested'));
    await writeFile(join(folder, 'invalid.js'), 'throw new Error("Untrusted script executed")');
    await writeFile(join(folder, 'nested', 'sample.HEIC'), 'synthetic candidate');
    browser = await chromium.launch({
      executablePath: process.env.RLC_CHROMIUM_PATH || undefined,
    });
    const address = process.env.RLC_SMOKE_URL;
    const localOrigin = address ? new URL(address).origin : null;
    if (localOrigin) {
      assert.match(localOrigin, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/);
    }
    const context = await browser.newContext({ offline: !address });
    const remoteRequests = [];
    await context.route(/^https?:/i, (route) => {
      if (new URL(route.request().url()).origin === localOrigin) {
        return route.continue();
      }
      remoteRequests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(address || pathToFileURL(join(__dirname, '..', 'index.html')).href);

    await page.locator('#input-folder').setInputFiles(folder);
    assert.equal(await page.locator('#folder-result').textContent(), '1 photo candidate, 1 other file, 1 nested candidate.');

    await page.locator('#decoder-bundle').setInputFiles(join(folder, 'invalid.js'));
    await page.locator('#heic-photo').setInputFiles(join(fixtures, 'split-color.heic'));
    await page.getByRole('button', { name: 'Decode HEIC' }).click();
    assert.match(await finished(page), /Decoder bundle does not match/);

    const alteredDecoder = await readFile(decoder);
    alteredDecoder[0] ^= 1;
    await page.locator('#decoder-bundle').setInputFiles({
      name: 'altered.js', mimeType: 'text/javascript', buffer: alteredDecoder,
    });
    await page.getByRole('button', { name: 'Decode HEIC' }).click();
    assert.match(await finished(page), /Decoder bundle does not match/);

    await page.locator('#decoder-bundle').setInputFiles(decoder);
    await page.getByRole('button', { name: 'Decode HEIC' }).click();
    assert.match(await finished(page), /64 × 32.*NCLX/);
    const pixel = await page.locator('#heic-preview').evaluate((canvas) => {
      return Array.from(canvas.getContext('2d').getImageData(8, 8, 1, 1).data);
    });
    assert.ok(pixel[0] > 150 && pixel[2] < 70, 'left half should be red');

    await page.locator('#heic-photo').setInputFiles(join(fixtures, 'scaled-preview.heic'));
    await page.getByRole('button', { name: 'Decode HEIC' }).click();
    assert.match(await finished(page), /1024 × 512/);
    assert.equal(await page.locator('#heic-preview').getAttribute('width'), '512');
    assert.equal(await page.locator('#heic-preview').getAttribute('height'), '256');

    await page.locator('#heic-photo').setInputFiles(join(fixtures, 'second-primary.heic'));
    await page.getByRole('button', { name: 'Decode HEIC' }).click();
    assert.match(await finished(page), /32 × 48.*2 top-level images/);

    await page.locator('#heic-photo').setInputFiles({
      name: 'damaged.heic', mimeType: 'image/heic', buffer: Buffer.from([0, 0, 0, 24]),
    });
    await page.getByRole('button', { name: 'Decode HEIC' }).click();
    assert.match(await finished(page), /No HEIC primary image/);
    assert.equal(await page.locator('#heic-preview').isVisible(), false);
    await page.getByRole('button', { name: 'Clear photo' }).click();
    assert.equal(await page.locator('#heic-result').textContent(), 'Ready');
    await page.evaluate(() => {
      window.showDirectoryPicker = async ({ mode }) => {
        if (mode !== 'readwrite') {
          throw new Error('Expected read/write picker');
        }
        return { queryPermission: async () => 'granted' };
      };
    });
    const picker = page.getByRole('button', { name: 'Check output folder picker' });
    await picker.click();
    assert.equal(await page.locator('#picker-result').textContent(), 'Picker opened. Write permission: granted. No files written.');

    await page.evaluate(() => {
      window.showDirectoryPicker = async () => {
        throw new DOMException('Cancelled', 'AbortError');
      };
    });
    await picker.click();
    assert.match(await page.locator('#picker-result').textContent(), /AbortError/);

    await page.evaluate(() => {
      window.showDirectoryPicker = undefined;
    });
    await picker.click();
    assert.match(await page.locator('#picker-result').textContent(), /unavailable/);

    await page.getByRole('button', { name: 'Check color round trip' }).click();
    await page.waitForFunction(() => document.querySelector('#color-result').textContent !== 'Checking color');
    const measurements = await page.locator('#color-measurements').textContent();
    assert.equal(await page.locator('#color-result').textContent(), 'Color smoke check passed', measurements);
    if (process.env.RLC_PRINT_EVIDENCE) {
      process.stdout.write(measurements + '\n');
    }
    assert.match(measurements, /display-p3 PNG: red 255,0,0/);
    assert.match(measurements, /sRGB PNG: red 255,0,0/);
    assert.match(measurements, /display-p3 JPEG: red/);
    assert.match(measurements, /sRGB JPEG: red/);
    assert.deepEqual(remoteRequests, []);
  } finally {
    await browser?.close();
    await rm(folder, { recursive: true, force: true });
  }
}

test().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

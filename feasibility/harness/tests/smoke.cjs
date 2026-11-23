'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({
    executablePath: process.env.RLC_CHROMIUM_PATH || undefined,
  });
  try {
    const address = process.env.RLC_SMOKE_URL;
    const localOrigin = address ? new URL(address).origin : null;
    if (localOrigin) {
      assert.match(localOrigin, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/);
    }
    const context = await browser.newContext({ offline: !address });
    await context.route(/^https?:/i, (route) => {
      if (new URL(route.request().url()).origin === localOrigin) {
        return route.continue();
      }
      return route.abort();
    });
    const page = await context.newPage();
    const remoteRequests = [];
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url()) && new URL(request.url()).origin !== localOrigin) {
        remoteRequests.push(request.url());
      }
    });
    await page.goto(address || pathToFileURL(join(__dirname, '..', 'index.html')).href);
    await page.getByRole('button', { name: 'Run smoke test' }).click();
    await page.waitForFunction(() => {
      return !['Running', 'Ready'].includes(document.querySelector('#summary').textContent);
    });
    assert.equal(await page.locator('#summary').textContent(), 'Smoke test passed');
    const [worker, module, encoders, storage] = await page.locator('#results dd').allTextContents();
    assert.equal(worker, 'Passed');
    if (address) {
      assert.equal(module, 'Module loaded');
    } else {
      assert.match(module, /^Module (loaded|blocked on this file origin \(expected\))$/);
    }
    assert.equal(encoders, 'Passed');
    assert.equal(storage, 'Saved. Reopen this page and check the marker.');
    await page.reload();
    await page.getByRole('button', { name: 'Check saved marker' }).click();
    assert.equal(await page.locator('#summary').textContent(), 'Saved marker found');
    assert.deepEqual(remoteRequests, []);
    await context.close();
  } finally {
    await browser.close();
  }
}

test().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

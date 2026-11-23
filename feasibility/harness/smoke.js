'use strict';

const markerKey = 'rlc.feasibility.smoke.v1';
const runButton = document.querySelector('#run');
const checkStorageButton = document.querySelector('#check-storage');
const summary = document.querySelector('#summary');
const results = document.querySelector('#results');

function addResult(label, message) {
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = message;
  results.append(term, detail);
}

function workerProgram() {
  self.onmessage = async ({ data }) => {
    try {
      const { instance } = await WebAssembly.instantiate(data);
      self.postMessage(instance.exports.answer());
    } catch (error) {
      self.postMessage(error.name);
    }
  };
}

async function probeWorker() {
  // One exported function, answer(), returns the constant 42.
  const wasm = Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 5, 1, 96, 0, 1, 127,
    3, 2, 1, 0,
    7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0,
    10, 6, 1, 4, 0, 65, 42, 11,
  ]);
  const source = new Blob(['(', workerProgram.toString(), ')();'], {
    type: 'text/javascript',
  });
  const url = URL.createObjectURL(source);
  let worker;
  let timeout;
  try {
    worker = new Worker(url);
    const answer = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Worker timed out')), 5000);
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = () => reject(new Error('Worker could not run'));
      worker.postMessage(wasm.buffer, [wasm.buffer]);
    });
    if (answer !== 42) {
      throw new Error('WASM probe did not return 42');
    }
  } finally {
    clearTimeout(timeout);
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}

async function probeModule() {
  let loaded = false;
  try {
    const module = await import('./module-probe.js');
    loaded = module.moduleProbe === 'loaded';
  } catch (error) {
    if (location.protocol !== 'file:') {
      throw error;
    }
  }
  if (location.protocol !== 'file:' && !loaded) {
    throw new Error('Module did not load from the local server');
  }
  return loaded ? 'Module loaded' : 'Module blocked on this file origin (expected)';
}

function encode(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== type) {
        reject(new Error(type + ' encoding failed or returned another format'));
        return;
      }
      resolve(blob);
    }, type);
  });
}

async function probeEncoders() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 8;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d15b4b';
  context.fillRect(0, 0, 16, 8);
  for (const type of ['image/jpeg', 'image/png']) {
    const blob = await encode(canvas, type);
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width !== 16 || bitmap.height !== 8) {
        throw new Error(type + ' did not round-trip at the expected size');
      }
    } finally {
      bitmap.close();
    }
  }
}

function saveMarker() {
  localStorage.setItem(markerKey, '1');
  return 'Saved. Reopen this page and check the marker.';
}

const checks = [
  ['Classic worker and byte-initialized WASM', probeWorker],
  ['Separate module control', probeModule],
  ['Canvas JPEG and PNG encode and decode', probeEncoders],
  ['Local marker storage', saveMarker],
];

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  checkStorageButton.disabled = true;
  summary.textContent = 'Running';
  results.replaceChildren();
  let allPassed = true;
  try {
    for (const [label, check] of checks) {
      try {
        addResult(label, (await check()) || 'Passed');
      } catch (error) {
        allPassed = false;
        addResult(label, 'Failed (' + error.message + ')');
      }
    }
    summary.textContent = allPassed ? 'Smoke test passed' : 'Smoke test found a failure';
  } finally {
    runButton.disabled = false;
    checkStorageButton.disabled = false;
  }
});

checkStorageButton.addEventListener('click', () => {
  try {
    summary.textContent = localStorage.getItem(markerKey) === '1'
      ? 'Saved marker found'
      : 'Saved marker missing';
  } catch (error) {
    summary.textContent = 'Saved marker unavailable (' + error.name + ')';
  }
});

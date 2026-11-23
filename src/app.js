'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const controls = ['exposure', 'warmth', 'saturation', 'contrast'];
  const state = { photos: [], checked: new Set(), current: null, serial: 0, busy: null, preview: null };
  const urls = new Set();
  const emptySettings = () => RlcPresets.adjustments();
  const prefs = RlcPresets.load({ getItem: (key) => localStorage.getItem(key) });
  const settings = prefs.value;
  const workerURLs = new Map();
  let serialQueue = Promise.resolve();
  let previewTimer;
  let correctedURL;
  let lastExport = null;

  function objectURL(blob) {
    const url = URL.createObjectURL(blob);
    urls.add(url);
    return url;
  }

  function revoke(url) {
    if (url && urls.delete(url)) URL.revokeObjectURL(url);
  }

  function say(message) {
    byId('status').textContent = message;
  }

  function savedPreferences(message) {
    const saved = RlcPresets.save({ setItem: (...args) => localStorage.setItem(...args) }, settings);
    byId('preset-status').textContent = saved ? message : 'Preferences are available for this session only.';
  }

  function runWorker(message, signal) {
    const task = serialQueue.then(() => {
      signal?.throwIfAborted();
      if (!globalThis.RlcWorkerSource) throw new Error('App worker is missing. Prepare the offline package first.');
      const isHeic = /\.hei[cf]$/i.test(message.file.name);
      if (!workerURLs.has(isHeic)) {
        const decoder = isHeic ? globalThis.RlcDecoderSource || '' : '';
        workerURLs.set(isHeic, objectURL(new Blob([decoder, '\n;\n', RlcWorkerSource], { type: 'text/javascript' })));
      }
      const worker = new Worker(workerURLs.get(isHeic));
      let timeout;
      let abort;
      return new Promise((resolve, reject) => {
        abort = () => reject(new DOMException('Cancelled', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }) => {
          if (data.error) reject(new Error(data.error));
          else resolve(data.result);
        };
        worker.onerror = () => reject(new Error('The image worker could not run.'));
        timeout = setTimeout(() => reject(new Error('Photo processing timed out.')), 120000);
        worker.postMessage(message);
      }).finally(() => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        worker.terminate();
      });
    });
    serialQueue = task.catch(() => {});
    return task;
  }

  function fileState(photo) {
    return ({ pending: 'Waiting', running: 'Analyzing', ready: photo.recipes
      ? photo.recipes[photo.mode].confidence + ' confidence' : 'Ready',
    failed: 'Failed. ' + (photo.error || ''), cancelled: 'Cancelled' })[photo.status];
  }

  function list() {
    const node = byId('photos');
    const active = document.activeElement?.dataset?.focusKey;
    node.replaceChildren();
    for (const photo of state.photos) {
      if (byId('filter').checked && photo.recipes?.[photo.mode].confidence !== 'Low') continue;
      const row = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.checked.has(photo.id);
      box.setAttribute('aria-label', 'Check ' + photo.label);
      box.dataset.focusKey = 'check-' + photo.id;
      box.onchange = () => box.checked ? state.checked.add(photo.id) : state.checked.delete(photo.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-current', String(state.current === photo));
      button.dataset.focusKey = 'photo-' + photo.id;
      const icon = document.createElement(photo.thumbURL ? 'img' : 'span');
      if (photo.thumbURL) {
        icon.src = photo.thumbURL;
        icon.alt = '';
        icon.loading = 'lazy';
      } else icon.className = 'thumb-placeholder';
      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = photo.label;
      const status = document.createElement('span');
      status.className = 'file-status';
      status.textContent = fileState(photo);
      label.append(status);
      button.append(icon, label);
      button.onclick = () => select(photo);
      row.append(box, button);
      node.append(row);
    }
    if (active) node.querySelector('[data-focus-key="' + active + '"]')?.focus({ preventScroll: true });
  }

  function setImage(element, url) {
    element.hidden = !url;
    if (url) element.src = url;
    else element.removeAttribute('src');
  }

  function updateOutputs() {
    for (const key of controls) document.querySelector('output[for="' + key + '"]').textContent = Number(byId(key).value).toFixed(2);
  }

  function readManual() {
    return RlcPresets.adjustments(Object.fromEntries(controls.map((key) => [key, byId(key).value])));
  }

  function showManual(manual) {
    for (const key of controls) byId(key).value = manual[key];
    updateOutputs();
  }

  function showConfidence(photo) {
    const mode = byId('mode').value;
    const recipe = photo?.recipes?.[mode];
    byId('confidence').textContent = recipe
      ? mode + ' automatic confidence: ' + recipe.confidence + '. ' + recipe.reasons.join(' ')
        + (mode === 'Aggressive' ? ' Colors may look invented and artifacts may increase.' : '')
      : '';
  }

  function select(photo) {
    state.current = photo;
    byId('photo-title').textContent = photo?.label || 'No photo selected';
    if (photo) byId('mode').value = photo.mode;
    showManual(photo?.manual || emptySettings());
    setImage(byId('original'), photo?.url);
    byId('color-warning').textContent = photo?.warnings?.join(' ') || '';
    list();
    updatePreview(true);
  }

  function updatePreview(clear = false) {
    clearTimeout(previewTimer);
    state.preview?.abort();
    state.preview = null;
    showConfidence(state.current);
    byId('clipping').textContent = '';
    if (clear) {
      setImage(byId('corrected'), null);
      revoke(correctedURL);
      correctedURL = null;
    }
    const photo = state.current;
    if (!photo?.original) return;
    const mode = byId('mode').value;
    const controller = new AbortController();
    state.preview = controller;
    previewTimer = setTimeout(async () => {
      try {
        const source = new File([photo.original], 'preview.png', { type: 'image/png' });
        const { preview, clipping } = await runWorker({
          action: 'preview', file: source, recipe: photo.recipes[mode], manual: readManual(),
        }, controller.signal);
        if (controller.signal.aborted) return;
        const next = objectURL(preview);
        setImage(byId('corrected'), next);
        revoke(correctedURL);
        correctedURL = next;
        byId('clipping').textContent = clipping > 0.025 ? 'Current adjustments clip detail in some pixels.' : '';
      } catch (error) {
        if (error.name !== 'AbortError') byId('clipping').textContent = 'Preview failed. ' + error.message;
      }
    }, 110);
  }

  function begin(count) {
    const controller = new AbortController();
    state.busy = controller;
    byId('progress').hidden = false;
    byId('progress').max = Math.max(1, count);
    byId('progress').value = 0;
    for (const id of ['folder', 'files', 'clear', 'save-folder', 'save-zip', 'retry', 'retry-export']) byId(id).disabled = true;
    byId('cancel').disabled = false;
    return controller;
  }

  function end() {
    state.busy = null;
    for (const id of ['folder', 'files', 'clear', 'save-folder', 'save-zip']) byId(id).disabled = false;
    byId('cancel').disabled = true;
    byId('retry').disabled = !state.photos.some((photo) => ['pending', 'failed', 'cancelled'].includes(photo.status));
    const retry = byId('retry-export');
    retry.hidden = !lastExport?.jobs.some((job) => ['failed', 'pending', 'cancelled'].includes(job.status));
    retry.disabled = retry.hidden;
  }

  async function analyze(photos, note = '') {
    if (!photos.length) {
      say(note || 'No new supported photos.');
      return;
    }
    const controller = begin(photos.length);
    let processed = 0;
    let failures = 0;
    try {
      for (const photo of photos) {
        if (controller.signal.aborted) break;
        photo.status = 'running';
        list();
        say('Analyzing ' + (processed + 1) + ' of ' + photos.length + '.');
        try {
          const result = await runWorker({ action: 'analyze', file: photo.file }, controller.signal);
          Object.assign(photo, result, { status: 'ready', url: objectURL(result.original), thumbURL: objectURL(result.thumbnail) });
          if (!state.current || state.current === photo) select(photo);
        } catch (error) {
          photo.status = error.name === 'AbortError' ? 'cancelled' : 'failed';
          photo.error = error.message;
          if (photo.status === 'failed') failures += 1;
        }
        byId('progress').value = ++processed;
        list();
      }
    } finally {
      say((controller.signal.aborted ? 'Analysis cancelled.' : 'Analysis complete.') + ' '
        + processed + ' processed, ' + failures + ' failed.' + (note ? ' ' + note : ''));
      end();
    }
  }

  function importFiles(files, folder) {
    if (state.busy) return;
    const existing = new Set(state.photos.map((photo) => photo.key));
    const pending = [];
    const batchKey = folder ? ++state.serial : 'files';
    let others = 0;
    let overflow = 0;
    for (const file of Array.from(files).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name))) {
      if (!/\.(hei[cf]|jpe?g|png)$/i.test(file.name)) {
        others += 1;
        continue;
      }
      const label = file.webkitRelativePath || file.name;
      const key = JSON.stringify([batchKey, label, file.size, file.lastModified]);
      if (existing.has(key)) continue;
      if (state.photos.length >= 100) {
        overflow += 1;
        continue;
      }
      existing.add(key);
      const photo = { id: ++state.serial, key, file, label, status: 'pending', mode: settings.mode, manual: emptySettings() };
      state.photos.push(photo);
      pending.push(photo);
    }
    list();
    const notes = [];
    if (others) notes.push(others + ' unsupported files skipped.');
    if (overflow) notes.push(overflow + ' photos exceeded the 100-photo limit.');
    void analyze(pending, notes.join(' '));
  }

  function scoped(scope) {
    if (scope === 'batch' || scope === 'all') return state.photos;
    if (scope === 'selected') return state.photos.filter((photo) => state.checked.has(photo.id));
    return state.current ? [state.current] : [];
  }

  function applyAdjustments(reset) {
    const targets = scoped(byId('scope').value);
    if (!targets.length) {
      say('Choose photos for these adjustments.');
      return;
    }
    const manual = reset ? emptySettings() : readManual();
    for (const photo of targets) {
      photo.manual = manual;
      if (!reset) photo.mode = byId('mode').value;
    }
    if (targets.includes(state.current)) showManual(manual);
    list();
    updatePreview();
    say((reset ? 'Reset adjustments on ' : 'Applied adjustments to ') + targets.length + ' photos.');
  }

  function logExport(job, status, detail = '') {
    job.status = status;
    if (!job.row) {
      job.row = document.createElement('li');
      byId('export-log').append(job.row);
    }
    job.row.textContent = job.name + ' · ' + status + (detail ? ' · ' + detail : '');
  }

  async function createDestination(root) {
    const name = 'Red Light Corrector ' + crypto.randomUUID();
    const directory = await root.getDirectoryHandle(name, { create: true });
    for await (const entry of directory.keys()) {
      if (entry) throw new Error('The output folder is not empty. Use ZIP instead.');
    }
    return directory;
  }

  async function saveFile(destination, name, blob) {
    for await (const entry of destination.keys()) {
      if (entry.toLowerCase() === name.toLowerCase()) throw new Error('A destination file already exists.');
    }
    const handle = await destination.getFileHandle(name, { create: true });
    if ((await handle.getFile()).size) throw new Error('A destination file already exists.');
    const stream = await handle.createWritable({ mode: 'exclusive' });
    try {
      await stream.write(blob);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }

  async function handoff(volume, part, signal) {
    if (!volume.central.length) return;
    signal.throwIfAborted();
    const blob = volume.finish();
    const button = byId('download');
    button.textContent = 'Download ZIP ' + part;
    button.hidden = false;
    say('ZIP ' + part + ' is ready to download.');
    try {
      await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        button.onclick = () => {
          signal.removeEventListener('abort', abort);
          const link = document.createElement('a');
          const url = objectURL(blob);
          link.href = url;
          link.download = 'red-light-corrected-' + String(part).padStart(2, '0') + '.zip';
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => revoke(url), 30000);
          resolve();
        };
      });
    } finally {
      button.hidden = true;
      button.onclick = null;
    }
  }

  function planExport() {
    const photos = scoped(byId('export-scope').value).filter((photo) => photo.status === 'ready');
    const modes = Array.from(document.querySelectorAll('[name="export-mode"]:checked'), (element) => element.value);
    const type = byId('format').value;
    const size = Number(byId('size').value);
    const used = new Set();
    return photos.flatMap((photo) => modes.map((mode) => ({
      status: 'pending', photo, recipe: photo.recipes[mode], manual: { ...photo.manual }, type, size,
      name: RlcZip.filename(photo.file.name, mode, type, used),
    })));
  }

  async function performExport(plan, jobs, chooseFolder = false) {
    const controller = begin(jobs.length);
    const { signal } = controller;
    let staged = [];
    let volume = new RlcZip.Volume();
    try {
      if (chooseFolder) {
        const root = await window.showDirectoryPicker({ mode: 'readwrite' });
        signal.throwIfAborted();
        plan.destination = await createDestination(root);
      }
      for (const [index, job] of jobs.entries()) {
        if (signal.aborted) break;
        logExport(job, 'Rendering');
        say('Preparing output ' + (index + 1) + ' of ' + jobs.length + '.');
        try {
          const { blob, warnings } = await runWorker({
            action: 'export', file: job.photo.file, fingerprint: job.photo.fingerprint,
            recipe: job.recipe, manual: job.manual, type: job.type, size: job.size,
          }, signal);
          signal.throwIfAborted();
          job.notes = warnings.join(' ');
          if (plan.destination) {
            await saveFile(plan.destination, job.name, blob);
            logExport(job, 'saved', job.notes);
          } else {
            if (!volume.fits(job.name, blob) && staged.length) {
              await handoff(volume, plan.part++, signal);
              for (const item of staged) logExport(item, 'handed off to Chrome', item.notes);
              staged = [];
              volume = new RlcZip.Volume();
            }
            await volume.add(job.name, blob);
            signal.throwIfAborted();
            staged.push(job);
            logExport(job, 'staged', job.notes);
          }
        } catch (error) {
          logExport(job, error.name === 'AbortError' ? 'cancelled' : 'failed', error.message);
        }
        byId('progress').value = index + 1;
      }
      if (staged.length) {
        await handoff(volume, plan.part++, signal);
        for (const job of staged) logExport(job, 'handed off to Chrome', job.notes);
      }
      const failed = jobs.filter((job) => job.status === 'failed').length;
      say(signal.aborted ? 'Export cancelled.' : 'Export run complete. ' + failed + ' outputs failed.');
    } catch (error) {
      for (const item of staged) logExport(item, signal.aborted ? 'cancelled' : 'failed', error.message);
      say(error.name === 'AbortError' ? 'Export cancelled.' : 'Export could not start or finish. ' + error.message);
    } finally {
      end();
    }
  }

  function startExport(direct) {
    if (state.busy) return;
    if (direct && !window.showDirectoryPicker) {
      say('Folder saving is unavailable in this context. Use Export ZIP.');
      return;
    }
    const jobs = planExport();
    if (!jobs.length) {
      say('Select at least one ready photo and one output mode.');
      return;
    }
    byId('export-log').replaceChildren();
    lastExport = { jobs, part: 1, destination: null, direct };
    void performExport(lastExport, jobs, direct);
  }

  function refreshPresets() {
    const select = byId('presets');
    select.replaceChildren();
    for (const preset of settings.presets) select.add(new Option(preset.name, preset.name));
    byId('load-preset').disabled = byId('delete-preset').disabled = !settings.presets.length;
  }

  for (const id of ['folder', 'files']) {
    byId(id).addEventListener('change', ({ target }) => {
      importFiles(target.files, id === 'folder');
      target.value = '';
    });
  }
  byId('clear').onclick = () => {
    if (state.busy) return;
    for (const photo of state.photos) {
      revoke(photo.url);
      revoke(photo.thumbURL);
    }
    state.photos = [];
    state.checked.clear();
    lastExport = null;
    byId('export-log').replaceChildren();
    byId('progress').hidden = true;
    select(null);
    end();
    say('Photos cleared.');
  };
  byId('cancel').onclick = () => state.busy?.abort();
  byId('retry').onclick = () => {
    if (state.busy) return;
    const unfinished = state.photos.filter((photo) => ['pending', 'failed', 'cancelled'].includes(photo.status));
    if (unfinished.length) void analyze(unfinished);
  };
  byId('retry-export').onclick = () => {
    if (state.busy || !lastExport) return;
    const jobs = lastExport.jobs.filter((job) => ['failed', 'pending', 'cancelled'].includes(job.status));
    if (jobs.length) void performExport(lastExport, jobs, lastExport.direct && !lastExport.destination);
  };
  byId('filter').onchange = list;
  byId('mode').onchange = () => {
    settings.mode = byId('mode').value;
    if (state.current) state.current.mode = settings.mode;
    savedPreferences('');
    list();
    updatePreview();
  };
  for (const key of controls) byId(key).oninput = () => {
    updateOutputs();
    updatePreview();
  };
  byId('apply').onclick = () => applyAdjustments(false);
  byId('reset').onclick = () => applyAdjustments(true);
  byId('save-folder').onclick = () => startExport(true);
  byId('save-zip').onclick = () => startExport(false);
  byId('format').onchange = () => {
    settings.format = byId('format').value;
    savedPreferences('');
  };
  byId('size').onchange = () => {
    settings.size = byId('size').value;
    savedPreferences('');
  };
  byId('save-preset').onclick = () => {
    const name = byId('preset-name').value.trim();
    if (!name) {
      byId('preset-status').textContent = 'Enter a preset name.';
      return;
    }
    const index = settings.presets.findIndex((preset) => preset.name === name);
    if (index === -1 && settings.presets.length >= 50) {
      byId('preset-status').textContent = 'Delete a preset before adding another.';
      return;
    }
    const preset = { name, mode: byId('mode').value, settings: readManual() };
    if (index >= 0) settings.presets[index] = preset;
    else settings.presets.push(preset);
    refreshPresets();
    byId('presets').value = name;
    savedPreferences('Preset saved.');
  };
  byId('load-preset').onclick = () => {
    const preset = settings.presets.find((entry) => entry.name === byId('presets').value);
    if (!preset) return;
    byId('mode').value = preset.mode;
    showManual(preset.settings);
    applyAdjustments(false);
  };
  byId('delete-preset').onclick = () => {
    settings.presets = settings.presets.filter((preset) => preset.name !== byId('presets').value);
    refreshPresets();
    savedPreferences('Preset deleted.');
  };
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    workerURLs.clear();
  });
  byId('mode').value = settings.mode;
  byId('format').value = settings.format;
  byId('size').value = settings.size;
  if (!prefs.available) byId('preset-status').textContent = 'Preferences are available for this session only.';
  refreshPresets();
  updateOutputs();
})();

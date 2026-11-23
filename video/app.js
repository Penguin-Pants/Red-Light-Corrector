'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  if (location.protocol === 'file:') {
    byId('startup').hidden = false;
    return;
  }

  const presets = {
    Natural: { red: -0.12, green: 0.03, blue: 0.04, saturation: 0.90 },
    Balanced: { red: -0.20, green: 0.06, blue: 0.08, saturation: 0.85 },
    Aggressive: { red: -0.30, green: 0.10, blue: 0.12, saturation: 0.76 },
  };
  const keys = Object.keys(presets.Natural);
  const videos = [];
  const results = new Set();
  const panes = [byId('video-original'), byId('video-corrected')];
  const list = byId('videos');
  let current;
  let preview;
  let active;
  let shared = { preset: 'Natural', ...presets.Natural };
  byId('video-app').hidden = false;
  if (typeof window.showDirectoryPicker !== 'function') byId('video-destination').value = 'downloads';

  function say(message) {
    byId('video-status').textContent = message;
  }

  function values(video) {
    return video?.override || shared;
  }

  function renderControls() {
    const busy = Boolean(active);
    const checked = videos.some((video) => video.checked);
    for (const id of ['video-files', 'video-settings', 'video-destination', 'video-start']) byId(id).disabled = busy;
    for (const id of ['video-all', 'video-none', 'video-clear']) byId(id).disabled = busy || !videos.length;
    byId('video-preview').disabled = busy || !current;
    byId('video-export').disabled = busy || !checked;
    byId('video-cancel').disabled = !busy;
    byId('video-play').disabled = busy || !preview;
    byId('video-scope').options[1].disabled = !current;
    byId('video-reset').disabled = !current?.override;
  }

  function renderList() {
    list.replaceChildren();
    for (const item of videos) {
      const row = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = item.checked;
      box.disabled = Boolean(active);
      box.setAttribute('aria-label', 'Check ' + item.file.name);
      box.onchange = () => {
        item.checked = box.checked;
        renderControls();
      };
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'secondary';
      open.disabled = Boolean(active);
      open.textContent = item.file.name + (item.override ? ' · Override' : '');
      open.setAttribute('aria-current', String(item === current));
      open.onclick = () => {
        if (item !== current) {
          discardPreview();
          current = item;
          byId('video-start').value = '0';
        }
        render();
      };
      row.append(box, open);
      list.append(row);
    }
  }

  function showSettings() {
    const item = byId('video-scope').value === 'clip' ? current : null;
    const settings = values(item);
    byId('video-preset').value = settings.preset;
    for (const key of keys) {
      byId('video-' + key).value = settings[key];
      document.querySelector('output[for="video-' + key + '"]').textContent = settings[key].toFixed(2);
    }
  }

  function render() {
    byId('video-title').textContent = current?.file.name || 'No video selected';
    renderList();
    showSettings();
    renderControls();
  }

  function importFiles(files) {
    if (active) return;
    let rejected = 0;
    let added = 0;
    for (const file of files) {
      if (!/\.(mov|mp4)$/i.test(file.name) || !file.size || file.size > 8 * 1024 ** 3 || videos.length >= 100) {
        rejected += 1;
      } else if (!videos.some((item) => item.file.name === file.name && item.file.size === file.size
          && item.file.lastModified === file.lastModified)) {
        videos.push({ file, checked: true, override: null });
        added += 1;
      }
    }
    current ||= videos[0];
    render();
    say(added + ' videos added.' + (rejected ? ' ' + rejected + ' skipped. Use MP4 or MOV files up to 8 GiB, with at most 100 videos.' : ''));
  }

  async function discard(id) {
    if (!id) return;
    try {
      const response = await fetch('/api/media/' + id, { method: 'DELETE', headers: { 'X-RLC-Video': '1' } });
      if (response.ok || response.status === 404) results.delete(id);
    } catch {
      // The launcher also removes the session files when it closes.
    }
  }

  function discardPreview() {
    const id = preview?.id;
    preview = null;
    for (const video of panes) {
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
    }
    byId('video-preview-notes').textContent = '';
    if (id) void discard(id);
  }

  function updateSettings(preset) {
    const next = preset ? { preset, ...presets[preset] } : {
      preset: 'Custom',
      ...Object.fromEntries(keys.map((key) => [key, Number(byId('video-' + key).value)])),
    };
    if (byId('video-scope').value === 'clip' && current) current.override = next;
    else shared = next;
    showSettings();
    if (preview) byId('video-preview-notes').textContent = 'Settings changed. Preview again to compare them.';
    renderList();
    renderControls();
  }

  async function requestVideo(action, item, correction, signal) {
    const response = await fetch('/api/' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-RLC-Video': '1',
        'X-RLC-Settings': JSON.stringify(correction),
      },
      body: item.file,
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Video processing failed.');
    results.add(result.id);
    return result;
  }

  async function operation(work) {
    if (active) return;
    const controller = new AbortController();
    active = controller;
    render();
    try {
      await work(controller.signal);
    } catch (error) {
      say(error.name === 'AbortError' ? 'Stopped.' : error.message || 'The local video operation failed.');
    } finally {
      active = null;
      render();
    }
  }

  function outputName(name, used) {
    let stem = name.replace(/\.(mov|mp4)$/i, '').normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100).toWellFormed().replace(/[ .]+$/, '');
    if (!stem) stem = 'video';
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
    let suffix = 1;
    let output;
    do {
      output = stem + '_corrected' + (suffix === 1 ? '' : '_' + suffix) + '.mp4';
      suffix += 1;
    } while (used.has(output.toLowerCase()));
    used.add(output.toLowerCase());
    return output;
  }

  async function exportDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') throw new Error('Folder access is unavailable. Choose Prepare downloads.');
    const parent = await window.showDirectoryPicker({ mode: 'readwrite' });
    const name = 'Red Light Corrector Videos ' + crypto.randomUUID();
    const directory = await parent.getDirectoryHandle(name, { create: true });
    for await (const key of directory.keys()) {
      if (key) throw new Error('The dedicated output folder is not empty.');
    }
    return { directory, name };
  }

  async function saveOutput(directory, name, result, signal) {
    for await (const key of directory.keys()) {
      if (key.toLowerCase() === name.toLowerCase()) throw new Error('That output already exists.');
    }
    const file = await directory.getFileHandle(name, { create: true });
    if ((await file.getFile()).size) throw new Error('That output already exists.');
    const response = await fetch(result.corrected, { signal });
    if (!response.ok || !response.body) throw new Error('The corrected file is not available.');
    const writer = await file.createWritable({ mode: 'exclusive' });
    await response.body.pipeTo(writer, { signal });
  }

  function exportChecked() {
    const chosen = videos.filter((video) => video.checked).map((video) => ({
      video, settings: { ...values(video) },
    }));
    if (!chosen.length) return;
    const outputList = byId('video-output');
    const saveFolder = byId('video-destination').value === 'folder';
    return operation(async (signal) => {
      const target = saveFolder ? await exportDirectory() : null;
      const used = new Set(Array.from(outputList.querySelectorAll('a[download]'), (link) => link.download.toLowerCase()));
      let done = 0;
      let failed = 0;
      for (const [index, item] of chosen.entries()) {
        signal.throwIfAborted();
        const name = outputName(item.video.file.name, used);
        say('Exporting ' + (index + 1) + ' of ' + chosen.length + '.');
        const row = document.createElement('li');
        outputList.append(row);
        let result;
        try {
          result = await requestVideo('export', item.video, item.settings, signal);
          const { color, copiedAudio, convertedAudio } = result.notes;
          const notes = color + ' Audio: ' + copiedAudio + ' copied, ' + convertedAudio + ' converted.';
          if (target) {
            await saveOutput(target.directory, name, result, signal);
            row.textContent = name + ' saved in ' + target.name + '. ' + notes;
            await discard(result.id);
          } else {
            const link = document.createElement('a');
            link.href = result.download;
            link.download = name;
            link.textContent = 'Download ' + name;
            row.append(link, ' · ' + notes);
          }
          done += 1;
        } catch (error) {
          row.textContent = name + ' · ' + (signal.aborted ? 'Cancelled.' : error.message);
          if (result && signal.aborted) await discard(result.id);
          else if (result) {
            const link = document.createElement('a');
            link.href = result.download;
            link.download = name;
            link.textContent = 'Download instead';
            row.append(' ', link);
          }
          if (signal.aborted) throw error;
          failed += 1;
        }
      }
      say(done + ' videos ' + (target ? 'saved' : 'ready to download') + ', ' + failed + ' failed.');
    });
  }

  byId('video-files').onchange = ({ target }) => {
    importFiles(target.files);
    target.value = '';
  };
  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = active ? 'none' : 'copy';
    document.documentElement.classList.toggle('dragging-photos', !active);
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) document.documentElement.classList.remove('dragging-photos');
  });
  window.addEventListener('drop', (event) => {
    document.documentElement.classList.remove('dragging-photos');
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    importFiles(event.dataTransfer.files);
  });
  byId('video-all').onclick = () => {
    for (const video of videos) video.checked = true;
    render();
  };
  byId('video-none').onclick = () => {
    for (const video of videos) video.checked = false;
    render();
  };
  byId('video-clear').onclick = () => operation(async () => {
    discardPreview();
    await Promise.all([...results].map(discard));
    videos.length = 0;
    current = null;
    byId('video-output').replaceChildren();
    byId('video-scope').value = 'shared';
    byId('video-start').value = '0';
    say('Videos cleared.');
  });
  byId('video-cancel').onclick = () => active?.abort();
  byId('video-scope').onchange = showSettings;
  byId('video-preset').onchange = (event) => updateSettings(event.target.value);
  byId('video-reset').onclick = () => {
    if (current) current.override = null;
    if (preview) byId('video-preview-notes').textContent = 'Settings changed. Preview again to compare them.';
    render();
  };
  for (const key of keys) byId('video-' + key).oninput = () => updateSettings();
  byId('video-preview').onclick = () => operation(async (signal) => {
    discardPreview();
    say('Preparing previews.');
    preview = await requestVideo('preview', current, { ...values(current), start: Number(byId('video-start').value) }, signal);
    for (const [index, key] of ['original', 'corrected'].entries()) {
      panes[index].src = preview[key];
      panes[index].hidden = false;
    }
    byId('video-preview-notes').textContent = 'From ' + preview.start.toFixed(1) + ' seconds. ' + preview.notes.color;
    say('Preview ready.');
  });
  byId('video-play').onclick = async () => {
    if (!preview) return;
    for (const video of panes) video.currentTime = 0;
    const playback = await Promise.allSettled(panes.map((video) => video.play()));
    if (playback.some((result) => result.status === 'rejected')) say('Use the video controls to start playback.');
  };
  byId('video-export').onclick = exportChecked;
  render();
})();

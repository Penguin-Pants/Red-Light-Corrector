'use strict';

globalThis.RlcPresets = (() => {
  const key = 'red-light-corrector.preferences.v1';
  const ranges = { exposure: [-2, 2], warmth: [-1, 1], saturation: [-1, 1], contrast: [-0.5, 0.5] };
  const modes = ['Natural', 'Balanced', 'Aggressive'];
  function adjustments(input = {}) {
    return Object.fromEntries(Object.entries(ranges).map(([name, [min, max]]) => {
      const value = Number(input?.[name]);
      return [name, Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0];
    }));
  }

  function clean(record = {}) {
    const presets = [];
    const names = new Set();
    for (const preset of (Array.isArray(record?.presets) ? record.presets : []).slice(0, 50)) {
      if (typeof preset?.name !== 'string') continue;
      const name = preset.name.trim().slice(0, 60);
      if (!name || names.has(name)) continue;
      names.add(name);
      presets.push({ name, mode: modes.includes(preset.mode) ? preset.mode : 'Natural', settings: adjustments(preset.settings) });
    }
    return {
      mode: modes.includes(record?.mode) ? record.mode : 'Natural',
      format: record?.format === 'image/png' ? 'image/png' : 'image/jpeg',
      size: ['0', '4096', '2048', '1024'].includes(record?.size) ? record.size : '0',
      presets,
    };
  }

  function load(storage) {
    try {
      return { value: clean(JSON.parse(storage.getItem(key))), available: true };
    } catch {
      return { value: clean(), available: false };
    }
  }

  function save(storage, record) {
    try {
      storage.setItem(key, JSON.stringify(clean(record)));
      return true;
    } catch {
      return false;
    }
  }

  return { adjustments, load, save };
})();

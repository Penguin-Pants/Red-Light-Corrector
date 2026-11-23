'use strict';

globalThis.RlcZip = (() => {
  const encoder = new TextEncoder();
  const limit = 256 * 1024 * 1024;

  function filename(original, mode, type, used) {
    let stem = original.replace(/\.[^.]+$/, '').normalize('NFC')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[ .]+$/, '').slice(0, 110).toWellFormed().trim();
    if (!stem) stem = 'photo';
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
    const suffix = '_' + mode.toLowerCase();
    const extension = type === 'image/png' ? '.png' : '.jpg';
    let name = stem + suffix + extension;
    let number = 2;
    while (used.has(name.toLowerCase())) {
      name = stem + suffix + '_' + number + extension;
      number += 1;
    }
    used.add(name.toLowerCase());
    return name;
  }

  async function checksum(blob) {
    let checksum = 0;
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return checksum;
        checksum = RlcMetadata.crc32(value, checksum);
      }
    } finally {
      reader.releaseLock();
    }
  }

  class Volume {
    constructor() {
      this.local = [];
      this.central = [];
      this.offset = 0;
      this.directoryBytes = 0;
    }

    fits(name, blob) {
      return this.offset + this.directoryBytes + blob.size + 98 + 2 * encoder.encode(name).length <= limit;
    }

    async add(name, blob) {
      if (!this.fits(name, blob)) throw new Error('This image exceeds the 256 MiB ZIP volume limit.');
      const file = encoder.encode(name);
      const crc = await checksum(blob);
      const header = new Uint8Array(30 + file.length);
      const local = new DataView(header.buffer);
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(12, 33, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, blob.size, true);
      local.setUint32(22, blob.size, true);
      local.setUint16(26, file.length, true);
      header.set(file, 30);
      const entry = new Uint8Array(46 + file.length);
      const directory = new DataView(entry.buffer);
      directory.setUint32(0, 0x02014b50, true);
      directory.setUint16(4, 20, true);
      entry.set(header.subarray(4, 30), 6);
      directory.setUint32(42, this.offset, true);
      entry.set(file, 46);
      this.central.push(entry);
      this.local.push(header, blob);
      this.offset += header.length + blob.size;
      this.directoryBytes += entry.length;
    }

    finish() {
      const end = new Uint8Array(22);
      const view = new DataView(end.buffer);
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, this.central.length, true);
      view.setUint16(10, this.central.length, true);
      view.setUint32(12, this.directoryBytes, true);
      view.setUint32(16, this.offset, true);
      return new Blob([...this.local, ...this.central, end], { type: 'application/zip' });
    }
  }

  return { filename, Volume };
})();

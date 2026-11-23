'use strict';
const assert = require('node:assert/strict');
require('../src/metadata.js');
require('../src/zip.js');
require('../src/presets.js');

(async () => {
  const { crc32, writeExif, attach, inspect } = RlcMetadata;
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const exif = Buffer.from('49492a0008000000020012010300010000000600000025880400010000002600000000000000010001000200020000005300000000000000', 'hex');
  const written = writeExif(exif, 200, 300);
  assert.equal(written.orientation, 6);
  const out = Buffer.from(written.output);
  assert.equal(out.readUInt16LE(18), 1);
  const gps = out.readUInt32LE(30);
  assert.equal(out.readUInt8(gps + 10), 'S'.charCodeAt(0));

  const jpeg = new Blob([Uint8Array.of(255, 216, 255, 217)], { type: 'image/jpeg' });
  const safeXmp = new TextEncoder().encode('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF>');
  const iptc = Uint8Array.from(Buffer.from('3842494d04040000000000061c0219000141', 'hex'));
  const tagged = await attach(jpeg, { exif, xmp: safeXmp, iptc, warnings: [] }, 200, 300);
  const parsed = inspect(new Uint8Array(await tagged.blob.arrayBuffer()));
  assert.deepEqual(parsed.exif, written.output);
  assert.deepEqual(parsed.xmp, safeXmp);
  assert.deepEqual(parsed.iptc, iptc);
  const unsafeXmp = new TextEncoder().encode('<rdf:RDF><rdf:Description tiff:Orientation="6"/></rdf:RDF>');
  assert.match(attach(jpeg, { xmp: unsafeXmp, warnings: [] }, 200, 300).warnings[0], /incompatible geometry/);

  const used = new Set();
  const name = RlcZip.filename('CON.jpg', 'Natural', 'image/jpeg', used);
  assert.equal(name, '_CON_natural.jpg');
  assert.equal(RlcZip.filename('con.jpg', 'Natural', 'image/jpeg', used), '_con_natural_2.jpg');
  const volume = new RlcZip.Volume();
  await volume.add(name, new Blob(['123456789']));
  const zip = Buffer.from(await volume.finish().arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);

  const storage = new Map();
  const browserStorage = { setItem: (key, value) => storage.set(key, value), getItem: (key) => storage.get(key) };
  assert.equal(RlcPresets.save(browserStorage, { format: 'image/png', image: 'discard', presets: [{ name: 'Cool', settings: { warmth: -3 } }] }), true);
  assert.deepEqual(RlcPresets.load(browserStorage).value.presets, [{ name: 'Cool', mode: 'Natural', settings: { exposure: 0, warmth: -1, saturation: 0, contrast: 0 } }]);
  assert.equal(JSON.stringify([...storage.values()]).includes('discard'), false);
  assert.equal(RlcPresets.load({ getItem: () => { throw Error('denied'); } }).available, false);
})().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

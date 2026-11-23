import { createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'dist', 'red-light-corrector');
const packageURL = 'https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz';
const packageHash = 'd0bfe7198bd624c524cef8ccf78e15ceb42683c87598c64c2e13ced0d8680932';
const bundleHash = '074b2b55ef3de477ba9f794ca381f3f0324c1cba8c91b4af07395f39c22d54cc';
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function readTar(archive) {
  const contents = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const name = archive.subarray(offset, offset + 100).toString().split('\0')[0];
    if (!name) break;
    const size = parseInt(archive.subarray(offset + 124, offset + 136).toString(), 8);
    const start = offset + 512;
    if (!Number.isSafeInteger(size) || size < 0 || start + size > archive.length) throw new Error('Invalid dependency archive.');
    contents.set(name, archive.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return contents;
}

const localArchive = process.argv[2];
let archive;
if (localArchive) archive = await readFile(localArchive);
else {
  const response = await fetch(packageURL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not download the pinned HEIC decoder package.');
  archive = Buffer.from(await response.arrayBuffer());
}
if (sha256(archive) !== packageHash) throw new Error('The HEIC package did not match its pinned checksum.');
const packageFiles = readTar(gunzipSync(archive));
const bundle = packageFiles.get('package/libheif-wasm/libheif-bundle.js');
if (!bundle || sha256(bundle) !== bundleHash) throw new Error('The HEIC worker bundle did not match its pinned checksum.');

await mkdir(join(destination, 'src'), { recursive: true });
const files = [
  ['index.html', 'index.html'],
  ['styles.css', 'styles.css'],
  ['src/app.js', 'src/app.js'],
  ['src/metadata.js', 'src/metadata.js'],
  ['src/presets.js', 'src/presets.js'],
  ['src/zip.js', 'src/zip.js'],
  ['docs/user-guide.md', 'README.md'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
];
for (const [from, to] of files) await copyFile(join(root, from), join(destination, to));
const worker = await Promise.all(['correction.js', 'metadata.js', 'worker.js'].map((name) => readFile(join(root, 'src', name), 'utf8')));
await writeFile(join(destination, 'decoder-source.js'), 'globalThis.RlcDecoderSource = ' + JSON.stringify(bundle.toString()) + ';\n');
await writeFile(join(destination, 'worker-source.js'), 'globalThis.RlcWorkerSource = ' + JSON.stringify(worker.join('\n;\n')) + ';\n');
await writeFile(join(destination, 'LIBHEIF-LICENSE.txt'), packageFiles.get('package/libheif-wasm/LICENSE'));
await writeFile(join(destination, 'LIBHEIF-JS-LICENSE.txt'), packageFiles.get('package/LICENSE'));

const outputs = [...files.map(([, to]) => to), 'decoder-source.js', 'worker-source.js', 'LIBHEIF-LICENSE.txt', 'LIBHEIF-JS-LICENSE.txt'];
const manifest = [];
for (const name of outputs.sort()) manifest.push(sha256(await readFile(join(destination, name))) + '  ' + name);
await writeFile(join(destination, 'SHA256SUMS.txt'), manifest.join('\n') + '\n');
process.stdout.write('Built ' + destination + '\n');

await import('../src/metadata.js');
await import('../src/zip.js');
const zip = new globalThis.RlcZip.Volume();
for (const name of [...outputs.sort(), 'SHA256SUMS.txt']) {
  await zip.add('red-light-corrector/' + name, new Blob([await readFile(join(destination, name))]));
}
const archivePath = join(dirname(destination), 'red-light-corrector.zip');
await writeFile(archivePath, Buffer.from(await zip.finish().arrayBuffer()));
process.stdout.write('Built ' + archivePath + '\n');

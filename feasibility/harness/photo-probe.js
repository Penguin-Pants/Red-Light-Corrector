'use strict';

(() => {
  const decoderHash = '074b2b55ef3de477ba9f794ca381f3f0324c1cba8c91b4af07395f39c22d54cc';
  const decoderSize = 2044206;
  const maximumPhotoBytes = 64 * 1024 * 1024;
  const decoderInput = document.querySelector('#decoder-bundle');
  const photoInput = document.querySelector('#heic-photo');
  const decodeButton = document.querySelector('#decode-heic');
  const clearButton = document.querySelector('#clear-heic');
  const status = document.querySelector('#heic-result');
  const preview = document.querySelector('#heic-preview');

  function clearPreview() {
    preview.hidden = true;
    preview.width = 0;
    preview.height = 0;
  }

  function decodeInWorker() {
    self.onmessage = async ({ data }) => {
      let lib;
      let decoder;
      let images = [];
      try {
        lib = await self.libheif?.();
        if (!lib?.HeifDecoder) {
          self.postMessage({ error: 'Decoder did not start in this worker.' });
          return;
        }
        const started = performance.now();
        decoder = new lib.HeifDecoder();
        images = decoder.decode(new Uint8Array(data));
        const primary = images.find((item) => item.is_primary());
        if (!primary) {
          self.postMessage({ error: 'No HEIC primary image was found.' });
          return;
        }
        const width = primary.get_width();
        const height = primary.get_height();
        if (width < 1 || height < 1 || width * height > 50000000) {
          self.postMessage({ error: 'Image exceeds the probe’s 50 megapixel limit or has invalid dimensions.' });
          return;
        }

        const profileCode = lib._heif_image_handle_get_color_profile_type(primary.handle.$$.ptr);
        const profile = new Map([
          [0x6e636c78, 'NCLX'],
          [0x70726f66, 'ICC'],
          [0x72494343, 'restricted ICC'],
          [0, 'no profile type reported'],
        ]).get(profileCode) || 'unrecognized profile type';

        const pixels = new ImageData(width, height);
        const image = await new Promise((resolve) => primary.display(pixels, resolve));
        if (!image) {
          self.postMessage({ error: 'The bundled decoder could not render the primary image.' });
          return;
        }
        const scale = Math.min(1, 512 / Math.max(width, height));
        const small = new OffscreenCanvas(
          Math.max(1, Math.round(width * scale)),
          Math.max(1, Math.round(height * scale)),
        );
        const context = small.getContext('2d');
        if (scale === 1) {
          context.putImageData(image, 0, 0);
        } else {
          const resized = new ImageData(small.width, small.height);
          for (let y = 0; y < small.height; y += 1) {
            const sourceRow = Math.floor(y * height / small.height) * width;
            for (let x = 0; x < small.width; x += 1) {
              const source = 4 * (sourceRow + Math.floor(x * width / small.width));
              const destination = 4 * (y * small.width + x);
              resized.data.set(image.data.subarray(source, source + 4), destination);
            }
          }
          context.putImageData(resized, 0, 0);
        }
        const bitmap = small.transferToImageBitmap();
        self.postMessage({
          width,
          height,
          profile,
          count: images.length,
          elapsed: Math.round(performance.now() - started),
          bitmap,
        }, [bitmap]);
      } catch {
        self.postMessage({ error: 'Bundled decoding failed. No preview was produced.' });
      } finally {
        for (const image of images) {
          image.free();
        }
        if (decoder?.decoder) {
          lib.heif_context_free(decoder.decoder);
        }
      }
    };
  }

  async function readDecoder(file) {
    if (!file || file.size !== decoderSize) {
      throw new Error('Decoder bundle does not match the pinned build.');
    }
    if (!globalThis.crypto?.subtle) {
      throw new Error('This context cannot verify the decoder bundle.');
    }
    const source = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', source);
    const hex = Array.from(new Uint8Array(digest), (value) => {
      return value.toString(16).padStart(2, '0');
    }).join('');
    if (hex !== decoderHash) {
      throw new Error('Decoder bundle does not match the pinned build.');
    }
    return source;
  }

  async function probeBundled(source, photo) {
    const bytes = await photo.arrayBuffer();
    const workerCode = new Blob([source, '\n;(', decodeInWorker.toString(), ')();'], {
      type: 'text/javascript',
    });
    const url = URL.createObjectURL(workerCode);
    let worker;
    let timeout;
    try {
      worker = new Worker(url);
      return await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.error) {
            reject(new Error(data.error));
            return;
          }
          resolve(data);
        };
        worker.onerror = () => reject(new Error('The bundled decoder worker could not run.'));
        timeout = setTimeout(() => reject(new Error('The bundled decoder timed out.')), 30000);
        worker.postMessage(bytes, [bytes]);
      });
    } finally {
      clearTimeout(timeout);
      worker?.terminate();
      URL.revokeObjectURL(url);
    }
  }

  async function probeNative(photo) {
    try {
      const bitmap = await createImageBitmap(photo);
      const dimensions = bitmap.width + ' × ' + bitmap.height;
      bitmap.close();
      return 'Native decode: ' + dimensions + '.';
    } catch {
      return 'Native decode did not produce a bitmap.';
    }
  }

  function reset() {
    clearPreview();
    status.textContent = 'Ready';
  }

  decoderInput.addEventListener('change', reset);
  photoInput.addEventListener('change', reset);
  clearButton.addEventListener('click', () => {
    photoInput.value = '';
    reset();
  });
  decodeButton.addEventListener('click', async () => {
    clearPreview();
    const photo = photoInput.files[0];
    if (!photo || photo.size > maximumPhotoBytes) {
      status.textContent = 'Select a HEIC photo of at most 64 MiB.';
      return;
    }
    const controls = [decodeButton, clearButton, decoderInput, photoInput];
    for (const control of controls) {
      control.disabled = true;
    }
    status.textContent = 'Decoding';
    try {
      const source = await readDecoder(decoderInput.files[0]);
      const probe = await probeBundled(source, photo);
      try {
        preview.width = probe.bitmap.width;
        preview.height = probe.bitmap.height;
        preview.getContext('2d').drawImage(probe.bitmap, 0, 0);
        preview.hidden = false;
      } finally {
        probe.bitmap.close();
      }
      const native = await probeNative(photo);
      status.textContent = 'Bundled: ' + probe.width + ' × ' + probe.height + ', '
        + probe.profile + ', ' + probe.count + ' top-level images, '
        + probe.elapsed + ' ms decode and preview. ' + native;
    } catch (error) {
      clearPreview();
      status.textContent = error.message;
    } finally {
      for (const control of controls) {
        control.disabled = false;
      }
    }
  });

  const folderInput = document.querySelector('#input-folder');
  const folderResult = document.querySelector('#folder-result');
  folderInput.addEventListener('change', () => {
    let candidates = 0;
    let nested = 0;
    for (const file of folderInput.files) {
      if (/\.(heic|heif|jpe?g|png)$/i.test(file.name)) {
        candidates += 1;
        if (file.webkitRelativePath.split('/').length > 2) {
          nested += 1;
        }
      }
    }
    const other = folderInput.files.length - candidates;
    folderResult.textContent = candidates + (candidates === 1 ? ' photo candidate, ' : ' photo candidates, ')
      + other + (other === 1 ? ' other file, ' : ' other files, ')
      + nested + (nested === 1 ? ' nested candidate.' : ' nested candidates.');
    folderInput.value = '';
  });

  const pickerButton = document.querySelector('#check-output-picker');
  const pickerResult = document.querySelector('#picker-result');
  pickerButton.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      pickerResult.textContent = 'Output folder picker is unavailable in this context.';
      return;
    }
    pickerButton.disabled = true;
    try {
      const folder = await window.showDirectoryPicker({ mode: 'readwrite' });
      const permission = await folder.queryPermission({ mode: 'readwrite' });
      pickerResult.textContent = 'Picker opened. Write permission: ' + permission + '. No files written.';
    } catch (error) {
      pickerResult.textContent = 'No output folder opened (' + error.name + ').';
    } finally {
      pickerButton.disabled = false;
    }
  });
})();

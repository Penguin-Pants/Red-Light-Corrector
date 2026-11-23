'use strict';

(() => {
  const button = document.querySelector('#check-color');
  const result = document.querySelector('#color-result');
  const preview = document.querySelector('#color-preview');
  const measurements = document.querySelector('#color-measurements');

  function contextFor(canvas, colorSpace) {
    const context = canvas.getContext('2d', { colorSpace });
    if (context?.getContextAttributes().colorSpace !== colorSpace) {
      throw new Error(colorSpace + ' Canvas is unavailable.');
    }
    return context;
  }

  function chartCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    return canvas;
  }

  async function readSignaling(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (blob.type === 'image/jpeg') {
      const identifier = 'ICC_PROFILE\u0000';
      for (let offset = 2; offset + 4 <= bytes.length;) {
        const marker = bytes[offset + 1];
        if (bytes[offset] !== 0xff || marker === 0xda || marker === 0xd9) {
          break;
        }
        const length = bytes[offset + 2] * 256 + bytes[offset + 3];
        if (length < 2 || offset + 2 + length > bytes.length) {
          break;
        }
        const start = offset + 4;
        if (marker === 0xe2 && length >= identifier.length + 2
            && String.fromCharCode(...bytes.subarray(start, start + identifier.length)) === identifier) {
          return 'ICC APP2';
        }
        offset += length + 2;
      }
      return 'no ICC marker';
    }

    const data = new DataView(bytes.buffer);
    const signals = [];
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = data.getUint32(offset);
      const chunk = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (offset + length + 12 > bytes.length) {
        throw new Error('PNG chunk extends beyond the encoded file.');
      }
      if (['iCCP', 'cICP', 'sRGB'].includes(chunk)) {
        signals.push(chunk);
      }
      offset += length + 12;
    }
    return signals.join(', ') || 'no profile chunk';
  }

  function sample(context, x) {
    return Array.from(context.getImageData(x, 16, 1, 1).data.subarray(0, 3));
  }

  async function roundTrip(source, space, mimeType) {
    const output = chartCanvas();
    contextFor(output, space).drawImage(source, 0, 0);
    const blob = await encode(output, mimeType);
    const decoded = await createImageBitmap(blob);
    try {
      const readback = contextFor(chartCanvas(), space);
      readback.drawImage(decoded, 0, 0);
      const red = sample(readback, 8);
      const gray = sample(readback, 48);
      return { red, gray, signaling: await readSignaling(blob) };
    } finally {
      decoded.close();
    }
  }

  function within(actual, expected, tolerance) {
    return actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    result.textContent = 'Checking color';
    measurements.textContent = '';
    preview.hidden = true;
    const lines = [];
    try {
      const chart = contextFor(preview, 'display-p3');
      chart.fillStyle = 'color(display-p3 1 0 0)';
      chart.fillRect(0, 0, 32, 32);
      chart.fillStyle = 'color(display-p3 0.4862745 0.4862745 0.4862745)';
      chart.fillRect(32, 0, 32, 32);
      preview.hidden = false;

      const source = await createImageBitmap(await encode(preview, 'image/png'));
      let checksPassed = true;
      try {
        for (const space of ['display-p3', 'srgb']) {
          for (const format of ['png', 'jpeg']) {
            const probe = await roundTrip(source, space, 'image/' + format);
            const tolerance = format === 'png' ? 2 : 10;
            const colorMatches = within(probe.red, [255, 0, 0], tolerance)
              && within(probe.gray, [124, 124, 124], tolerance);
            const profilePresent = !probe.signaling.startsWith('no ');
            const passed = colorMatches && (space !== 'display-p3' || profilePresent);
            if (!passed) {
              checksPassed = false;
            }
            const label = space === 'srgb' ? 'sRGB' : space;
            lines.push(label + ' ' + format.toUpperCase() + ': red ' + probe.red.join(',')
              + ' · gray ' + probe.gray.join(',') + ' · ' + probe.signaling
              + ' · ' + (passed ? 'passed' : 'failed'));
          }
        }
      } finally {
        source.close();
      }
      result.textContent = checksPassed ? 'Color smoke check passed' : 'Color smoke check found a failure';
    } catch (error) {
      result.textContent = error.message;
    } finally {
      measurements.textContent = lines.join('\n');
      button.disabled = false;
    }
  });
})();

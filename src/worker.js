'use strict';

const maximumPixels = 50000000;
const maximumBytes = 128 * 1024 * 1024;
let decoderModule;
const previewLimit = 1000;

function checkSize(width, height) {
  if (width < 1 || height < 1 || width * height > maximumPixels) {
    throw new Error('This image exceeds the 50 megapixel limit.');
  }
}

function canvasFor(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { colorSpace: 'display-p3', willReadFrequently: true });
  if (context?.getContextAttributes().colorSpace !== 'display-p3') {
    throw new Error('This browser could not start Display P3 Canvas.');
  }
  return { canvas, context };
}

function fit(width, height, limit) {
  const factor = limit ? Math.min(1, limit / Math.max(width, height)) : 1;
  return [Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor))];
}

function heicMetadata(lib, image) {
  const result = { exif: null, xmp: null, warnings: [] };
  const handle = image.handle.$$.ptr;
  const count = lib._heif_image_handle_get_number_of_metadata_blocks(handle, 0);
  if (!count) return result;
  if (count > 128) return { ...result, warnings: ['Too many HEIC metadata blocks. Source metadata was omitted.'] };
  const ids = lib._malloc(count * 4);
  const error = lib._malloc(12);
  try {
    const total = lib._heif_image_handle_get_list_of_metadata_block_IDs(handle, 0, ids, count);
    for (let i = 0; i < total; i += 1) {
      const id = lib.HEAPU32[ids / 4 + i];
      const type = lib._heif_image_handle_get_metadata_type(handle, id);
      const format = String.fromCharCode(...lib.HEAPU8.subarray(type, type + 4));
      const contentType = format === 'mime' ? lib._heif_image_handle_get_metadata_content_type(handle, id) : 0;
      const isXmp = contentType && String.fromCharCode(...lib.HEAPU8.subarray(contentType, contentType + 19)) === 'application/rdf+xml';
      const key = format === 'Exif' ? 'exif' : isXmp ? 'xmp' : null;
      if (!key || result[key]) {
        if (!result.warnings.includes('Additional HEIC metadata blocks were omitted.')) {
          result.warnings.push('Additional HEIC metadata blocks were omitted.');
        }
        continue;
      }
      const size = lib._heif_image_handle_get_metadata_size(handle, id);
      if (size < 12 || size > 1024 * 1024) {
        result.warnings.push('A malformed or oversized HEIC metadata block was omitted.');
        continue;
      }
      const dest = lib._malloc(size);
      try {
        lib._heif_image_handle_get_metadata(error, handle, id, dest);
        if (lib.HEAP32[error / 4]) {
          result.warnings.push('A HEIC metadata block could not be read.');
          continue;
        }
        const data = lib.HEAPU8.slice(dest, dest + size);
        if (key === 'xmp') result.xmp = data;
        else {
          const start = 4 + new DataView(data.buffer).getUint32(0);
          if (start + 8 <= size) result.exif = data.subarray(start);
          else result.warnings.push('The HEIC EXIF offset was invalid.');
        }
      } finally {
        lib._free(dest);
      }
    }
  } finally {
    lib._free(ids);
    lib._free(error);
  }
  return result;
}

function heicSpace(lib, image, warnings) {
  const handle = image.handle.$$.ptr;
  const profile = lib._heif_image_handle_get_color_profile_type(image.handle.$$.ptr);
  if (profile === 0x6e636c78) {
    const error = lib._malloc(16);
    try {
      lib.HEAPU32[error / 4 + 3] = 0;
      lib._heif_image_handle_get_nclx_color_profile(error, handle, error + 12);
      const pointer = lib.HEAPU32[error / 4 + 3];
      if (!lib.HEAP32[error / 4] && pointer) {
        try {
          const primaries = lib.HEAP32[pointer / 4 + 1];
          const transfer = lib.HEAP32[pointer / 4 + 2];
          if (transfer === 13 && primaries === 12) return 'display-p3';
          if (transfer === 13 && primaries === 1) return 'srgb';
          warnings.push('HEIC color transfer or primaries are outside the verified SDR profiles. Color may differ.');
        } finally {
          lib._heif_nclx_color_profile_free(pointer);
        }
      }
    } finally {
      lib._free(error);
    }
  } else if (!profile) {
    warnings.push('No HEIC color profile was found. The preview assumes sRGB.');
  }
  return 'srgb';
}

function heicIcc(lib, image, warnings) {
  const profile = lib._heif_image_handle_get_color_profile_type(image.handle.$$.ptr);
  if (profile !== 0x70726f66 && profile !== 0x72494343) return null;
  const handle = image.handle.$$.ptr;
  const size = lib._heif_image_handle_get_raw_color_profile_size(handle);
  if (size < 128 || size > 1024 * 1024) {
    warnings.push('The HEIC ICC profile was invalid or too large. The preview assumes sRGB.');
    return null;
  }
  const dest = lib._malloc(size);
  const error = lib._malloc(12);
  try {
    lib._heif_image_handle_get_raw_color_profile(error, handle, dest);
    const data = lib.HEAPU8.slice(dest, dest + size);
    const header = String.fromCharCode(...data.subarray(36, 40));
    if (lib.HEAP32[error / 4] || header !== 'acsp') {
      warnings.push('The HEIC ICC profile could not be read. The preview assumes sRGB.');
      return null;
    }
    return data;
  } finally {
    lib._free(dest);
    lib._free(error);
  }
}

async function heicPixels(data, profile, warnings) {
  const { width, height } = data;
  if (profile) {
    const intermediate = new OffscreenCanvas(width, height);
    try {
      intermediate.getContext('2d').putImageData(data, 0, 0);
      const tagged = await RlcMetadata.tagPng(await encode(intermediate, 'image/png'), profile);
      intermediate.width = 0;
      return await createImageBitmap(tagged);
    } catch {
      warnings.push('The browser could not apply the HEIC ICC profile. The preview assumes sRGB.');
    } finally {
      intermediate.width = 0;
    }
  }
  const decoded = canvasFor(width, height);
  decoded.context.putImageData(data, 0, 0);
  return decoded.canvas;
}

function orientationTransform(context, orientation, width, height) {
  const transforms = {
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  if (transforms[orientation]) context.transform(...transforms[orientation]);
}

async function decodeHeic(bytes) {
  if (!globalThis.libheif) throw new Error('HEIC decoder is missing. Run the packaging step.');
  const lib = await (decoderModule ||= globalThis.libheif());
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(bytes);
  try {
    const image = images.find((entry) => entry.is_primary());
    if (!image) throw new Error('Could not read the primary HEIC image.');
    const width = image.get_width();
    const height = image.get_height();
    checkSize(width, height);
    const metadata = heicMetadata(lib, image);
    const space = heicSpace(lib, image, metadata.warnings);
    const data = new ImageData(width, height, { colorSpace: space });
    if (!await new Promise((resolve) => image.display(data, resolve))) {
      throw new Error('Could not decode the HEIC pixels.');
    }
    const profile = heicIcc(lib, image, metadata.warnings);
    const decoded = await heicPixels(data, profile, metadata.warnings);
    let orientation = 1;
    if (metadata.exif) {
      try {
        const tag = RlcMetadata.writeExif(metadata.exif, width, height).orientation;
        const id = lib._heif_image_handle_get_item_id(image.handle.$$.ptr);
        const rotates = lib._heif_item_get_properties_of_type(decoder.decoder, id, 0x69726f74, 0, 0);
        const mirrors = lib._heif_item_get_properties_of_type(decoder.decoder, id, 0x696d6972, 0, 0);
        if (!rotates && !mirrors) orientation = tag;
      } catch {
        metadata.warnings.push('HEIC EXIF orientation could not be verified.');
      }
    }
    if (orientation === 1 || orientation < 2 || orientation > 8) return { source: decoded, metadata };
    const upright = canvasFor(orientation >= 5 ? height : width, orientation >= 5 ? width : height);
    orientationTransform(upright.context, orientation, width, height);
    upright.context.drawImage(decoded, 0, 0);
    if (decoded.close) decoded.close();
    else decoded.width = 0;
    return { source: upright.canvas, metadata };
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) lib.heif_context_free(decoder.decoder);
  }
}

function checkRasterHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    checkSize(view.getUint32(16), view.getUint32(20));
    return;
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let position = 2; position + 9 < bytes.length;) {
      if (bytes[position] !== 255) break;
      if (bytes[position + 1] === 255) {
        position += 1;
        continue;
      }
      const marker = bytes[position + 1];
      if (marker === 218 || marker === 217) break;
      const length = view.getUint16(position + 2);
      if (length < 2 || position + length + 2 > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && length >= 8) {
        checkSize(view.getUint16(position + 7), view.getUint16(position + 5));
        return;
      }
      position += length + 2;
    }
  }
  throw new Error('This file is damaged or is not a supported JPEG or PNG.');
}

async function load(file, bytes) {
  if (/\.hei[cf]$/i.test(file.name)) return decodeHeic(bytes);
  checkRasterHeader(bytes);
  const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    checkSize(source.width, source.height);
    return { source, metadata: RlcMetadata.inspect(bytes) };
  } catch (error) {
    source.close();
    throw error;
  }
}

function render({ context, canvas }, recipe, manual) {
  if (recipe.gains.every((value) => value === 1) && !recipe.desaturate
      && Object.values(manual).every((value) => !value)) return 0;
  let total = 0;
  for (let y = 0; y < canvas.height; y += 128) {
    const image = context.getImageData(0, y, canvas.width, Math.min(128, canvas.height - y), { colorSpace: 'display-p3' });
    total += RlcCorrection.apply(image.data, recipe, manual) * image.height;
    context.putImageData(image, 0, y);
  }
  return total / canvas.height;
}

async function encode(canvas, type) {
  const output = await canvas.convertToBlob({ type, quality: 0.94 });
  if (output.type !== type) throw new Error('The browser did not produce the selected file type.');
  return output;
}

async function processJob({ action, file, fingerprint, recipe, manual, type, size }) {
  if (file.size > maximumBytes) throw new Error('This photo exceeds the 128 MiB input limit.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest)).join('.');
  if (fingerprint && fingerprint !== hash) throw new Error('The source changed. Import it again before exporting.');
  const loaded = await load(file, bytes);
  const { source, metadata } = loaded;
  try {
    const isExport = action === 'export';
    const [width, height] = fit(source.width, source.height, isExport ? size : previewLimit);
    const target = canvasFor(width, height);
    target.context.drawImage(source, 0, 0, width, height);
    if (action === 'analyze') {
      const [smallWidth, smallHeight] = fit(width, height, 180);
      const sample = canvasFor(smallWidth, smallHeight);
      sample.context.drawImage(target.canvas, 0, 0, smallWidth, smallHeight);
      const [thumbWidth, thumbHeight] = fit(width, height, 128);
      const thumb = canvasFor(thumbWidth, thumbHeight);
      thumb.context.drawImage(target.canvas, 0, 0, thumbWidth, thumbHeight);
      const data = sample.context.getImageData(0, 0, smallWidth, smallHeight, { colorSpace: 'display-p3' }).data;
      return {
        recipes: RlcCorrection.analyze(data),
        original: await encode(target.canvas, 'image/png'),
        thumbnail: await encode(thumb.canvas, 'image/png'),
        warnings: metadata.warnings,
        width: source.width,
        height: source.height,
        fingerprint: hash,
      };
    }
    const clipping = render(target, recipe, manual);
    if (!isExport) return { preview: await encode(target.canvas, 'image/png'), clipping };
    if (type === 'image/jpeg') {
      target.context.globalCompositeOperation = 'destination-over';
      target.context.fillStyle = 'white';
      target.context.fillRect(0, 0, width, height);
    }
    const output = await encode(target.canvas, type);
    return RlcMetadata.attach(output, metadata, width, height);
  } finally {
    if (source.close) source.close();
    else source.width = 0;
  }
}

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ result: await processJob(data) });
  } catch (error) {
    self.postMessage({ error: error.message || 'The operation failed.' });
  }
};

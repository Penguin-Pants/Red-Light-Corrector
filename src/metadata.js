'use strict';

globalThis.RlcMetadata = (() => {
  const types = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  const pointers = new Set([0x8769, 0x8825, 0xa005]);
  const invalidated = new Set([0x0111, 0x0116, 0x0117, 0x0144, 0x0145, 0x014a, 0x0201, 0x0202, 0x927c]);
  const text = (data, start, size) => String.fromCharCode(...data.subarray(start, start + size));
  const utf8 = new TextEncoder();
  const xmpJpeg = 'http://ns.adobe.com/xap/1.0/\0';
  const xmpPng = 'XML:com.adobe.xmp';
  const photoshop = 'Photoshop 3.0\0';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
    for (let bit = 0; bit < 8; bit += 1) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
    return i;
  });

  function crc32(data, initial = 0) {
    let crc = initial ^ -1;
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ -1) >>> 0;
  }

  function photoshopIptc(data, start, end) {
    if (end - start < photoshop.length || text(data, start, photoshop.length) !== photoshop) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let iptc = null;
    let other = false;
    for (let offset = start + photoshop.length; offset < end;) {
      if (offset + 12 > end || text(data, offset, 4) !== '8BIM') return null;
      const id = view.getUint16(offset + 4);
      const nameLength = data[offset + 6] + 1;
      const sizeStart = offset + 6 + nameLength + nameLength % 2;
      if (sizeStart + 4 > end) return null;
      const size = view.getUint32(sizeStart);
      const next = sizeStart + 4 + size + size % 2;
      if (next > end) return null;
      if (id === 0x0404 && size > 0 && data[sizeStart + 4] === 0x1c && !iptc) iptc = data.subarray(offset, next);
      else other = true;
      offset = next;
    }
    return { iptc, other };
  }

  function inspect(data) {
    const result = { exif: null, xmp: null, iptc: null, warnings: [] };
    const add = (message) => {
      if (!result.warnings.includes(message)) result.warnings.push(message);
    };
    if (data[0] === 255 && data[1] === 216) {
      for (let offset = 2; offset + 4 < data.length && data[offset] === 255;) {
        const marker = data[offset + 1];
        if (marker === 218 || marker === 217) break;
        const length = data[offset + 2] * 256 + data[offset + 3];
        const start = offset + 4;
        const end = offset + 2 + length;
        if (length < 2 || end > data.length) break;
        if (marker === 225 && text(data, start, 6) === 'Exif\0\0') {
          result.exif ||= data.subarray(start + 6, end);
        } else if (marker === 225 && text(data, start, xmpJpeg.length) === xmpJpeg) {
          if (result.xmp) add('An additional XMP block was omitted.');
          else result.xmp = data.subarray(start + xmpJpeg.length, end);
        } else if (marker === 225) {
          add('A source application segment or extended XMP block was omitted.');
        } else if (marker === 237) {
          const block = photoshopIptc(data, start, end);
          if (block?.iptc && !result.iptc) result.iptc = block.iptc;
          else add('An unreadable or additional Photoshop/IPTC block was omitted.');
          if (block?.other) add('Other Photoshop resources were omitted.');
        } else if ((marker === 226 && text(data, start, 12) !== 'ICC_PROFILE\0') || marker === 254) {
          add('Source auxiliary data or image comments were omitted.');
        }
        offset = end;
      }
    } else if (data[0] === 137 && text(data, 1, 3) === 'PNG') {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let offset = 8; offset + 12 <= data.length;) {
        const length = view.getUint32(offset);
        const end = offset + length + 12;
        if (end > data.length) break;
        const kind = text(data, offset + 4, 4);
        if (kind === 'eXIf' && length <= 1024 * 1024) result.exif ||= data.subarray(offset + 8, end - 4);
        else if (kind === 'eXIf') add('Oversized PNG EXIF was omitted.');
        else if (kind === 'iTXt' && text(data, offset + 8, xmpPng.length + 1) === xmpPng + '\0') {
          const headerEnd = offset + 8 + xmpPng.length + 1;
          const languageEnd = data.indexOf(0, headerEnd + 2);
          const translationEnd = data.indexOf(0, languageEnd + 1);
          if (data[headerEnd] !== 0 || languageEnd < headerEnd + 2
              || translationEnd <= languageEnd || translationEnd >= end - 4 || result.xmp) {
            add('Compressed, malformed or additional PNG XMP was omitted.');
          } else {
            result.xmp = data.subarray(translationEnd + 1, end - 4);
          }
        } else if (['iTXt', 'tEXt', 'zTXt', 'tIME'].includes(kind)) add('PNG text or timestamp chunks were omitted.');
        else if (['cICP', 'mDCV', 'cLLI'].includes(kind)) add('Source HDR signaling is not copied to the SDR export.');
        offset = end;
      }
    }
    return result;
  }

  function writeExif(input, width, height) {
    const original = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const little = original.getUint16(0) === 0x4949;
    if ((!little && original.getUint16(0) !== 0x4d4d) || original.getUint16(2, little) !== 42) throw new Error('Invalid EXIF');
    if (input.byteLength > 1024 * 1024) throw new Error('Oversized EXIF');
    const warnings = new Set();
    const seen = new Set();
    let orientation = 1;

    function read(offset, scope, depth) {
      if (seen.has(offset) || depth > 4) throw new Error('Invalid EXIF directory');
      seen.add(offset);
      const count = original.getUint16(offset, little);
      if (count > 1024 || offset + count * 12 + 6 > input.byteLength) throw new Error('Invalid EXIF directory');
      const entries = [];
      for (let i = 0; i < count; i += 1) {
        const position = offset + 2 + i * 12;
        const tag = original.getUint16(position, little);
        const type = original.getUint16(position + 2, little);
        const length = original.getUint32(position + 4, little);
        const size = (types[type] || 0) * length;
        if (scope !== 'gps' && invalidated.has(tag)) {
          warnings.add('Embedded thumbnails, offset-dependent notes or stale image-data references were omitted.');
          continue;
        }
        if (!size || size > input.byteLength) {
          warnings.add('An unsupported EXIF field was omitted.');
          continue;
        }
        const start = size <= 4 ? position + 8 : original.getUint32(position + 8, little);
        if (start + size > input.byteLength) throw new Error('Invalid EXIF value');
        if (scope !== 'gps' && pointers.has(tag) && length === 1 && (type === 4 || type === 13)) {
          const child = read(original.getUint32(start, little), tag === 0x8825 ? 'gps' : 'exif', depth + 1);
          entries.push({ tag, type: 4, length: 1, child });
          continue;
        }
        if (type === 13) {
          warnings.add('An unsupported EXIF pointer was omitted.');
          continue;
        }
        let bytes = input.slice(start, start + size);
        if (scope !== 'gps' && [0x0112, 0x0100, 0x0101, 0xa002, 0xa003].includes(tag)) {
          if (tag === 0x0112 && type === 3 && length === 1) orientation = original.getUint16(start, little);
          bytes = new Uint8Array(4);
          const value = tag === 0x0112 ? 1 : tag === 0x0100 || tag === 0xa002 ? width : height;
          if (tag === 0x0112) {
            new DataView(bytes.buffer).setUint16(0, value, little);
            entries.push({ tag, type: 3, length: 1, bytes });
          } else {
            new DataView(bytes.buffer).setUint32(0, value, little);
            entries.push({ tag, type: 4, length: 1, bytes });
          }
          continue;
        }
        entries.push({ tag, type, length, bytes });
      }
      if (original.getUint32(offset + count * 12 + 2, little)) warnings.add('Secondary EXIF directories and embedded previews were omitted.');
      return entries;
    }

    const root = read(original.getUint32(4, little), 'root', 0);
    let length = 8;
    const place = (entries) => {
      const start = length;
      length += 6 + entries.length * 12;
      for (const entry of entries) {
        if (entry.child) entry.offset = place(entry.child);
        else if (entry.bytes.length > 4) {
          entry.offset = length;
          length += entry.bytes.length + entry.bytes.length % 2;
        }
      }
      return start;
    };
    place(root);
    if (length > 1024 * 1024) throw new Error('Oversized rebuilt EXIF');
    const output = new Uint8Array(length);
    const view = new DataView(output.buffer);
    view.setUint16(0, little ? 0x4949 : 0x4d4d);
    view.setUint16(2, 42, little);
    view.setUint32(4, 8, little);
    function write(entries, offset) {
      view.setUint16(offset, entries.length, little);
      entries.forEach((entry, index) => {
        const start = offset + 2 + index * 12;
        view.setUint16(start, entry.tag, little);
        view.setUint16(start + 2, entry.type, little);
        view.setUint32(start + 4, entry.length, little);
        if (entry.offset) view.setUint32(start + 8, entry.offset, little);
        if (entry.child) write(entry.child, entry.offset);
        else output.set(entry.bytes, entry.offset || start + 8);
      });
    }
    write(root, 8);
    return { output, warnings: [...warnings], orientation };
  }

  function pngChunk(kind, data) {
    const raw = new Uint8Array(12 + data.length);
    const view = new DataView(raw.buffer);
    view.setUint32(0, data.length);
    raw.set(utf8.encode(kind), 4);
    raw.set(data, 8);
    view.setUint32(8 + data.length, crc32(raw.subarray(4, 8 + data.length)));
    return raw;
  }

  async function tagPng(blob, profile) {
    const zlib = new CompressionStream('deflate');
    const compressed = new Uint8Array(await new Response(new Blob([profile]).stream().pipeThrough(zlib)).arrayBuffer());
    const tag = new Uint8Array(5 + compressed.length);
    tag.set(utf8.encode('ICC'), 0);
    tag.set(compressed, 5);
    const data = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(data.buffer);
    const parts = [blob.slice(0, 33), pngChunk('iCCP', tag)];
    for (let offset = 33; offset + 12 <= data.length;) {
      const length = view.getUint32(offset);
      const end = offset + length + 12;
      if (end > data.length) throw new Error('Invalid encoded PNG.');
      if (!['iCCP', 'sRGB', 'cICP', 'gAMA', 'cHRM'].includes(text(data, offset + 4, 4))) {
        parts.push(blob.slice(offset, end));
      }
      offset = end;
    }
    return new Blob(parts, { type: 'image/png' });
  }

  function xmpPacket(bytes, warnings) {
    if (!bytes) return null;
    try {
      if (bytes.length > 1024 * 1024) throw new Error('Oversized XMP');
      const xml = decoder.decode(bytes);
      const stale = /<!DOCTYPE|<!ENTITY|:HasExtendedXMP\b|:(Orientation|ImageWidth|ImageHeight|ImageLength|PixelXDimension|PixelYDimension|Thumbnail|Thumbnails|PreviewImage|DateTimeOriginal|SubSecTimeOriginal|OffsetTimeOriginal|GainMap|DepthMap)\b/i;
      if (!/<(?:[\w.-]+:)?RDF[\s>]/i.test(xml) || stale.test(xml)) {
        warnings.push('XMP with incompatible geometry, capture fields, auxiliary data or external declarations was omitted.');
        return null;
      }
      return bytes;
    } catch {
      warnings.push('Malformed or oversized XMP was omitted.');
      return null;
    }
  }

  function jpegSegment(markerCode, prefix, data) {
    const marker = new Uint8Array(4);
    marker.set([255, markerCode]);
    new DataView(marker.buffer).setUint16(2, prefix.length + data.length + 2);
    return [marker, utf8.encode(prefix), data];
  }

  function attach(blob, metadata, width, height) {
    const warnings = [...metadata.warnings];
    let exif = null;
    if (metadata.exif) {
      try {
        const sanitized = writeExif(metadata.exif, width, height);
        exif = sanitized.output;
        warnings.push(...sanitized.warnings);
      } catch {
        warnings.push('EXIF was invalid or too large and was omitted.');
      }
    }
    const xmp = xmpPacket(metadata.xmp, warnings);
    if (blob.type === 'image/jpeg') {
      const parts = [];
      if (exif && exif.length + 8 <= 65535) parts.push(...jpegSegment(225, 'Exif\0\0', exif));
      else if (exif) warnings.push('EXIF exceeds the JPEG segment limit and was omitted.');
      if (xmp && xmp.length + xmpJpeg.length + 2 <= 65535) parts.push(...jpegSegment(225, xmpJpeg, xmp));
      else if (xmp) warnings.push('XMP exceeds the JPEG segment limit and was omitted.');
      if (metadata.iptc && metadata.iptc.length + photoshop.length + 2 <= 65535) {
        parts.push(...jpegSegment(237, photoshop, metadata.iptc));
      } else if (metadata.iptc) warnings.push('IPTC exceeds the JPEG segment limit and was omitted.');
      return {
        blob: parts.length ? new Blob([blob.slice(0, 2), ...parts, blob.slice(2)], { type: blob.type }) : blob,
        warnings,
      };
    }
    const chunks = [];
    if (metadata.iptc) warnings.push('JPEG IPTC was omitted from PNG because this build has no verified equivalent mapping.');
    if (exif) chunks.push(pngChunk('eXIf', exif));
    if (xmp) {
      const header = utf8.encode(xmpPng + '\0\0\0\0\0');
      const text = new Uint8Array(header.length + xmp.length);
      text.set(header);
      text.set(xmp, header.length);
      chunks.push(pngChunk('iTXt', text));
    }
    return {
      blob: chunks.length ? new Blob([blob.slice(0, 33), ...chunks, blob.slice(33)], { type: blob.type }) : blob,
      warnings,
    };
  }

  return { crc32, inspect, writeExif, attach, tagPng };
})();

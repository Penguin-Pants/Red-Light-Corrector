import { spawn } from 'node:child_process';

const audioCopy = new Set(['aac', 'mp3', 'alac', 'ac3', 'eac3']);
const defaults = { red: -0.12, green: 0.03, blue: 0.04, saturation: 0.9 };

export function settings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid correction settings.');
  const output = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = input[key] ?? fallback;
    const limits = key === 'saturation' ? [0, 1.5] : [-0.5, 0.5];
    if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) {
      throw new Error('Correction settings are outside their supported range.');
    }
    output[key] = Number(value.toFixed(3));
  }
  const start = input.start ?? 0;
  if (!Number.isFinite(start) || start < 0 || start > 86400) throw new Error('Invalid preview start time.');
  return { ...output, start: Number(start.toFixed(3)) };
}

async function run(command, args, signal, label, { output = false } = {}) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal, windowsHide: true, stdio: ['ignore', output ? 'pipe' : 'ignore', 'pipe'] });
    let stdout = '';
    let stderrBytes = 0;
    let failure;
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 1024 * 1024) {
        failure = new Error(label + ' returned too much data.');
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; });
    child.once('error', (error) => {
      failure ||= error.name === 'AbortError' ? error : new Error(label + ' could not start. Check the FFmpeg installation.');
    });
    child.once('close', (code) => {
      if (signal.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else if (code !== 0) reject(new Error(label + ' failed. Check the file and use a full FFmpeg build with libx264 and zscale.'
        + (stderrBytes ? '' : ' No diagnostic was available.')));
      else resolve(stdout);
    });
  });
}

const inputOptions = ['-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0'];

export async function probe(command, input, signal) {
  const data = JSON.parse(await run(command, [
    '-v', 'error', ...inputOptions, '-show_streams', '-show_format', '-of', 'json', input,
  ], signal, 'Video inspection', { output: true }));
  const video = data.streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const duration = Number(video?.duration ?? data.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 86400
      || !video.width || !video.height || video.width > 8192 || video.height > 8192) {
    throw new Error('No supported video stream found. Choose an MP4 or MOV clip up to 24 hours and 8192 pixels per side.');
  }
  const dolby = video.side_data_list?.find((entry) => entry.dv_profile != null);
  if (dolby?.dv_profile === 5 || dolby?.bl_present_flag === 0) {
    throw new Error('This Dolby Vision clip has no supported HDR base layer. Export an SDR copy before importing it.');
  }
  const hdr = ['smpte2084', 'arib-std-b67'].includes(video.color_transfer);
  if (dolby && !hdr) throw new Error('This Dolby Vision color format is unsupported. Export an SDR copy first.');
  const audio = data.streams.filter((stream) => stream.codec_type === 'audio');
  if (audio.length > 16) throw new Error('The clip contains more than 16 audio tracks.');
  return { video, audio, duration, hdr, dolby: Boolean(dolby) };
}

export function filterGraph(info, correction, preview) {
  const filters = [];
  if (info.hdr) {
    filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=mobius:desat=2',
      'zscale=t=bt709:m=bt709:r=limited', 'format=yuv420p');
  } else if (info.video.color_primaries === 'smpte432' || info.video.color_primaries === 'bt2020') {
    filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709:t=bt709:m=bt709:r=limited', 'format=yuv420p');
  }
  if (correction) {
    const { red, green, blue, saturation } = correction;
    const balance = [['rs', red * 0.55], ['gs', green * 0.55], ['bs', blue * 0.55],
      ['rm', red], ['gm', green], ['bm', blue], ['rh', red * 0.7], ['gh', green * 0.7], ['bh', blue * 0.7]];
    filters.push('colorbalance=' + balance.map(([key, value]) => key + '=' + value.toFixed(4)).join(':') + ':pl=1');
    filters.push('eq=saturation=' + saturation);
  }
  if (preview) filters.push("scale='min(960,iw)':'min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:out_color_matrix=bt709");
  else filters.push('scale=iw:ih:out_color_matrix=bt709', 'pad=ceil(iw/2)*2:ceil(ih/2)*2');
  return filters.join(',');
}

export async function encode(command, input, output, info, correction, signal, { preview = false, start = 0 } = {}) {
  const args = ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-filter_threads', '2'];
  if (preview) args.push('-ss', String(start));
  args.push(...inputOptions, '-threads', '2', '-i', input, '-map', '0:' + info.video.index);
  if (preview) args.push('-t', '8');
  else for (const stream of info.audio) args.push('-map', '0:' + stream.index);
  args.push('-vf', filterGraph(info, correction, preview), '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-threads:v', '4', '-preset', preview ? 'veryfast' : 'medium', '-crf', preview ? '22' : '18',
    '-pix_fmt', 'yuv420p', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv');
  if (!preview && info.audio.length) {
    args.push('-c:a', 'copy');
    info.audio.forEach((stream, index) => {
      if (!audioCopy.has(stream.codec_name)) args.push('-c:a:' + index, 'aac', '-b:a:' + index, '192k');
    });
  }
  args.push('-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1', '-movflags', '+faststart+write_colr', output);
  await run(command, args, signal, preview ? 'Preview encoding' : 'Export encoding');
}

export function outputNotes(info) {
  const copied = info.audio.filter((stream) => audioCopy.has(stream.codec_name)).length;
  return {
    color: info.hdr ? 'HDR base layer converted to SDR.' : 'SDR Rec. 709 output.',
    copiedAudio: copied,
    convertedAudio: info.audio.length - copied,
  };
}

export async function checkTools(ffmpeg, ffprobe) {
  const signal = AbortSignal.timeout(10000);
  await Promise.all([run(ffmpeg, ['-version'], signal, 'FFmpeg'), run(ffprobe, ['-version'], signal, 'ffprobe')]);
}

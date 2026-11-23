'use strict';

globalThis.RlcCorrection = (() => {
  const modes = Object.freeze(['Natural', 'Balanced', 'Aggressive']);
  const strengths = { Natural: 0.48, Balanced: 0.8, Aggressive: 1 };
  const linear = Array.from({ length: 256 }, (_, value) => {
    const x = value / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const signal = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const encoded = (x) => {
    const value = clamp(x, 0, 1);
    return 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
  };

  function stats(data) {
    const count = [0, 0, 0];
    const cubes = [0, 0, 0];
    let visible = 0;
    let weak = 0;
    let clipped = 0;
    let red = 0;
    let disagreement = 0;
    const step = 4 * Math.max(1, Math.floor(data.length / 65536));
    for (let i = 0; i < data.length; i += step) {
      if (data[i + 3] < 32) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) < 24) continue;
      visible += 1;
      if (g < 19 || b < 19) weak += 1;
      if (r > 249 || g > 249 || b > 249) clipped += 1;
      if (r > 1.36 * Math.max(g, b) + 12) red += 1;
      if (Math.max(g, b) > r * 1.15 + 10) disagreement += 1;
      for (let c = 0; c < 3; c += 1) {
        const value = linear[data[i + c]];
        count[c] += value;
        cubes[c] += value ** 3;
      }
    }
    const total = Math.max(1, visible);
    return {
      visible, means: count.map((v) => v / total), shades: cubes.map((v) => (v / total) ** (1 / 3)),
      weak: weak / total, clipped: clipped / total, red: red / total,
      mixed: disagreement / total > 0.16 && red / total > 0.28,
    };
  }

  function gains(channels, strength, limited) {
    const [r, g, b] = channels;
    const target = Math.max(0.015, signal(r, g, b));
    const cap = limited ? 1.7 : 3.25;
    return channels.map((c) => 1 + (clamp(target / Math.max(c, 0.011), 0.48, cap) - 1) * strength);
  }

  function rank(candidate, source, strength) {
    const [r, g, b] = source.means.map((v, i) => v * candidate.gains[i]);
    const afterCast = Math.abs(r - (g + b) / 2) * (1 - candidate.desaturate);
    const brightness = Math.abs(signal(r, g, b) - signal(...source.means));
    const noise = Math.max(0, ...candidate.gains.map((v) => v - 1)) * source.weak;
    return afterCast + brightness * 0.65 + noise * (0.055 - strength * 0.017)
      + candidate.desaturate * 0.024;
  }

  function analyze(data) {
    const source = stats(data);
    const cast = source.red >= 0.38 && source.means[0] > 1.5 * Math.max(source.means[1], source.means[2], 0.006);
    const reasons = [];
    if (cast) reasons.push('Dominant red cast detected.');
    if (source.weak > 0.25) reasons.push('Weak green or blue signal limits recoverable color. Boosting it may increase noise.');
    if (source.clipped > 0.12) reasons.push('Clipped channels have lost detail.');
    if (source.mixed) reasons.push('Lighting varies across this photo.');
    if (!source.visible) reasons.push('There is too little visible signal to assess color.');
    if (!reasons.length) reasons.push('No strong red cast or major clipping detected.');
    const confidence = !source.visible || source.weak > 0.45 || source.clipped > 0.3 || source.mixed
      ? 'Low'
      : cast || source.clipped > 0.12 ? 'Moderate' : 'High';
    return Object.fromEntries(modes.map((mode) => {
      const strength = strengths[mode];
      const neutral = { gains: [1, 1, 1], desaturate: 0 };
      const candidates = [neutral];
      if (cast) {
        const limited = source.weak > 0.4;
        candidates.push(
          { gains: gains(source.means, strength, limited), desaturate: limited ? strength * 0.22 : 0 },
          { gains: gains(source.shades, strength, limited), desaturate: strength * 0.12 },
          { gains: [1, 1, 1], desaturate: strength * (limited ? 0.72 : 0.35) },
        );
      }
      const recipe = candidates.reduce((best, current) => rank(current, source, strength) < rank(best, source, strength) - 1e-6 ? current : best);
      return [mode, { ...recipe, confidence, reasons }];
    }));
  }

  function apply(data, recipe, manual = {}) {
    const exposure = 2 ** clamp(Number(manual.exposure) || 0, -2, 2);
    const warmth = clamp(Number(manual.warmth) || 0, -1, 1);
    const saturation = Math.max(0, (1 - recipe.desaturate) * (1 + clamp(Number(manual.saturation) || 0, -1, 1)));
    const contrast = clamp(Number(manual.contrast) || 0, -0.5, 0.5);
    const redGain = recipe.gains[0] * (1 + warmth * 0.4);
    const blueGain = recipe.gains[2] * (1 - warmth * 0.4);
    let clipped = 0;
    let visible = 0;
    if (redGain === 1 && recipe.gains[1] === 1 && blueGain === 1 && exposure === 1 && saturation === 1 && contrast === 0) return 0;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      let r = linear[data[i]] * redGain;
      let g = linear[data[i + 1]] * recipe.gains[1];
      let b = linear[data[i + 2]] * blueGain;
      const y = signal(r, g, b);
      r = ((y + (r - y) * saturation) * (1 + contrast) - contrast * 0.18) * exposure;
      g = ((y + (g - y) * saturation) * (1 + contrast) - contrast * 0.18) * exposure;
      b = ((y + (b - y) * saturation) * (1 + contrast) - contrast * 0.18) * exposure;
      if (Math.max(r, g, b) > 1.001 || Math.min(r, g, b) < -0.001) clipped += 1;
      visible += 1;
      data[i] = encoded(r);
      data[i + 1] = encoded(g);
      data[i + 2] = encoded(b);
    }
    return clipped / Math.max(1, visible);
  }

  return { analyze, apply, modes };
})();

// Placeholder landscapes for the local demo: a sky gradient, a sun or moon, and hills, peaks or sea.
export type Mood = 'dawn' | 'noon' | 'dusk' | 'night';
export type Scene = 'hills' | 'sea' | 'peaks';

export interface SceneSpec {
  mood: Mood;
  scene: Scene;
  seed: number;
  width: number;
  height: number;
}

export const PALETTES: Record<Mood, { sky: [string, string]; orb: string; far: string; near: string; sea: string }> = {
  dawn: { sky: ['#f6c6a8', '#fbe7c6'], orb: '#fff3d6', far: '#c79a9a', near: '#8e6f7e', sea: '#d9a7a0' },
  noon: { sky: ['#7fb8e6', '#d8ecf7'], orb: '#fffbe6', far: '#8fbf9a', near: '#4f8a63', sea: '#3f86b5' },
  dusk: { sky: ['#5b3f7a', '#f29e6d'], orb: '#ffd28a', far: '#6e4a6b', near: '#3b2c4a', sea: '#a3577a' },
  night: { sky: ['#0b1530', '#27365e'], orb: '#e8ecf5', far: '#1d2a4a', near: '#101a33', sea: '#18284d' },
};

/** A small seeded random generator (mulberry32), so a scene looks the same on every run. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A closed shape under a ridge line: smooth hills, or straight-edged peaks. */
function ridge(width: number, height: number, base: number, amp: number, steps: number, rnd: () => number, sharp: boolean): string {
  const step = width / steps;
  let d = `M0 ${height} L0 ${r1(base - rnd() * amp)}`;
  for (let i = 1; i <= steps; i++) {
    const x = i * step;
    const y = base - rnd() * amp;
    d += sharp ? ` L${r1(x)} ${r1(y)}` : ` Q${r1(x - step / 2)} ${r1(base - amp - rnd() * amp * 0.5)} ${r1(x)} ${r1(y)}`;
  }
  return `${d} L${width} ${height} Z`;
}

export function sceneSvg({ mood, scene, seed, width, height }: SceneSpec): string {
  const p = PALETTES[mood];
  const rnd = random(seed);
  const unit = Math.min(width, height);
  const horizon = height * (0.55 + rnd() * 0.12);
  const orb = { x: width * (0.2 + rnd() * 0.6), y: height * (0.18 + rnd() * 0.2), r: unit * (mood === 'night' ? 0.06 : 0.09) };
  const parts = [
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient></defs>`,
    `<rect width="${width}" height="${height}" fill="url(#sky)"/>`,
  ];
  if (mood === 'night') {
    for (let i = 0; i < 40; i++) {
      parts.push(`<circle cx="${r1(rnd() * width)}" cy="${r1(rnd() * horizon * 0.8)}" r="${r1(unit * (0.002 + rnd() * 0.003))}" fill="#fff" opacity="${r1(0.4 + rnd() * 0.6)}"/>`);
    }
  }
  parts.push(`<circle cx="${r1(orb.x)}" cy="${r1(orb.y)}" r="${r1(orb.r)}" fill="${p.orb}"/>`);
  if (scene === 'sea') {
    parts.push(`<rect y="${r1(horizon)}" width="${width}" height="${r1(height - horizon)}" fill="${p.sea}"/>`);
    for (let i = 0; i < 6; i++) {
      const y = horizon + (height - horizon) * (0.1 + i * 0.14);
      const w = orb.r * (2.4 - i * 0.3);
      parts.push(`<rect x="${r1(orb.x - w / 2)}" y="${r1(y)}" width="${r1(w)}" height="${r1(unit * 0.006)}" rx="${r1(unit * 0.003)}" fill="${p.orb}" opacity="0.35"/>`);
    }
  } else {
    const peaks = scene === 'peaks';
    parts.push(`<path d="${ridge(width, height, horizon, height * (peaks ? 0.3 : 0.1), peaks ? 7 : 4, rnd, peaks)}" fill="${p.far}"/>`);
    parts.push(`<path d="${ridge(width, height, horizon + height * 0.15, height * 0.08, 3, rnd, false)}" fill="${p.near}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

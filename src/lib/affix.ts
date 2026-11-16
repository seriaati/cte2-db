// Client-safe types and game rules. Keep data imports out of this file so the
// extracted JSON never ends up in the browser bundle.

export interface StatMod {
  id: string;
  name: string;
  // The game's explanation of the stat; empty where it has none.
  desc: string;
  type: 'FLAT' | 'PERCENT' | 'MORE';
  min: number;
  max: number;
  percent: boolean;
  // The game prints a long stat as its name alone; the value only shows where the name has [VAL1].
  long: boolean;
  // Level multiplier is base + perLevel * (level - 1). Only flat mods scale.
  scaling: { base: number; perLevel: number } | null;
}

export interface Affix {
  id: string;
  name: string;
  type: 'prefix' | 'suffix' | 'implicit' | 'enchant' | 'chaos_stat' | 'jewel_corruption';
  weight: number;
  requireAll: boolean;
  included: string[];
  excluded: string[];
  stats: StatMod[];
}

// A pixel icon traced from a game texture: an SVG path on a w × h grid.
export interface Icon {
  d: string;
  w: number;
  h: number;
}

export interface Base {
  id: string;
  name: string;
  family: string;
  slot: string;
  icon: Icon;
  tags: string[];
}

export interface Rarity {
  id: string;
  name: string;
  color: string;
  // Text colour: the in-game colour, lightened where that is too dark to read on the site.
  ink: string;
  minPercent: number;
  maxPercent: number;
}

// Mirrors TagRequirement.meetsRequierment in Mine and Slash.
export function canRoll(affix: Affix, base: Base): boolean {
  const has = (tag: string) => base.tags.includes(tag);
  if (affix.excluded.some(has)) return false;
  return affix.requireAll ? affix.included.every(has) : affix.included.some(has);
}

export function rolled(mod: StatMod, percent: number, level: number): number {
  const value = mod.min + ((mod.max - mod.min) * percent) / 100;
  const scale = mod.type === 'FLAT' && mod.scaling ? mod.scaling.base + mod.scaling.perLevel * (level - 1) : 1;
  return value * scale;
}

const round = (v: number) => +v.toFixed(Math.abs(v) < 10 ? 2 : 1);

export function formatStat(mod: StatMod, rarity: Rarity, level: number): { value: string; label: string; desc: string } {
  return formatRange(mod, rolled(mod, rarity.minPercent, level), rolled(mod, rarity.maxPercent, level));
}

export function formatRange(mod: StatMod, from: number, to: number): { value: string; label: string; desc: string } {
  const [a, b] = [round(from), round(to)];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const negative = hi < 0;
  const range = lo === hi ? `${Math.abs(lo)}` : lo < 0 && hi > 0 ? `${lo} to ${hi}` : negative ? `${-hi}–${-lo}` : `${lo}–${hi}`;

  const { desc } = mod;
  if (mod.long) return { value: '', label: mod.name.replace('[VAL1]', negative ? `-${range}` : range), desc };
  if (mod.type === 'PERCENT') return { value: `${range}%`, label: `${negative ? 'reduced' : 'increased'} ${mod.name}`, desc };
  if (mod.type === 'MORE') return { value: `${range}%`, label: `${negative ? 'less' : 'more'} ${mod.name}`, desc };
  // A few stat names carry their own leading percent sign.
  const ownPercent = mod.name.startsWith('%');
  return {
    value: `${negative ? '-' : '+'}${range}${mod.percent || ownPercent ? '%' : ''}`,
    label: ownPercent ? mod.name.slice(1).trim() : mod.name,
    desc,
  };
}

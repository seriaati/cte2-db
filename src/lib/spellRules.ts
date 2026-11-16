// Client-safe types and game rules for the spells page. Like affix.ts, no data imports here.
import { formatRange, rolled, type StatMod } from './affix';

// A number that grows with the spell's level. Only a spell with every bonus level from gear reaches max.
export interface Leveled {
  min: number;
  max: number;
}

type Scaling = NonNullable<StatMod['scaling']>;

// One [calc:id] placeholder of a spell description.
export interface Calc {
  parts: { stat: string; multi: Leveled; target: boolean }[];
  // The parts after the first can't add more than this many times what the first one, weapon damage, gives.
  cap: number | null;
  base: Leveled;
  // The base grows with the player's level, like a flat stat.
  scaling: Scaling | null;
}

export interface Spell {
  id: string;
  name: string;
  icon: string;
  // The class that teaches it, and the player level its row of the class screen opens at.
  school: string;
  level: number;
  // How many points it takes; gear can add bonusLevels more.
  maxLevel: number;
  desc: string;
  // A second spell this one sets off, which the game shows while Alt is held.
  linked: { name: string; desc: string } | null;
  calcs: Record<string, Calc>;
  mana: Leveled;
  energy: Leveled;
  channel: boolean;
  // Cooldown, cast time and the rest of what doesn't change with level.
  facts: [label: string, value: string][];
  tags: string[];
  stats: StatMod[];
}

// The game does this arithmetic in 32-bit floats and then drops the fraction, so the rounding has to match.
const f = Math.fround;
const int = (v: number) => Math.trunc(f(v));
const multiplier = (s: Scaling, level: number) => f(s.base + f(f(s.perLevel) * (level - 1)));

// LeveledValue.getValue in Mine and Slash.
function leveled(v: Leveled, rank: number, topRank: number) {
  const min = f(v.min);
  return f(min + f(f(f(f(v.max) - min) / topRank) * rank));
}

// Spell.getCalculatedManaCost: a channelled spell that costs anything costs at least 1 a pulse.
export function cost(spell: Spell, type: 'mana' | 'energy', rank: number, topRank: number, scaling: Scaling, level: number) {
  const value = int(multiplier(scaling, level) * leveled(spell[type], rank, topRank));
  return spell.channel && spell[type].min > 0 ? Math.max(1, value) : value;
}

// What the game prints for a placeholder while Shift is held, minus the total, which depends on the caster's stats.
export function calcText(calc: Calc, rank: number, topRank: number, level: number) {
  const percent = (multi: Leveled, times = 1) => int(f(leveled(multi, rank, topRank) * 100) * times);
  const terms = calc.parts.map((p) => `${percent(p.multi)}% of ${p.target ? "the target's " : ''}${p.stat}`);
  if (calc.cap) terms.push(`${terms.pop()} (capped to ${percent(calc.parts[0].multi, calc.cap)}% of ${calc.parts[0].stat})`);
  const base = int(leveled(calc.base, rank, topRank) * (calc.scaling ? multiplier(calc.scaling, level) : 1));
  if (base > 0 || !terms.length) terms.push(`${base}`);
  return terms.join(' + ');
}

// Spell.getStats: the spell's level picks the point between a stat's min and max, as a whole percentage.
export function spellStat(mod: StatMod, rank: number, topRank: number, level: number) {
  const value = rolled(mod, int(f(rank / topRank) * 100), level);
  return formatRange(mod, value, value);
}

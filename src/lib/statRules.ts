// Client-safe: how Mine and Slash adds up what a character's stats come to. Like affix.ts, no data imports here.
import type { StatMod } from './affix';

export interface StatDef {
  name: string;
  percent: boolean;
  long: boolean;
  base: number;
  min: number;
  max: number;
  // A damage stat keeps its "more" multipliers beside the value instead of multiplying them in.
  apart: boolean;
  // Left off the game's own stat screen.
  hidden: boolean;
}

// A stat that adds to another once the rest is worked out: a percentage of the other stat, or an
// amount for every so many points of it.
export interface Derived {
  id: string;
  from: string;
  to: string;
  per?: number;
  priority: number;
}

export interface StatRules {
  defs: Record<string, StatDef>;
  transfers: Record<string, string[]>;
  // What one point of an attribute gives.
  core: Record<string, StatMod[]>;
  derived: Derived[];
}

export interface Exact {
  id: string;
  type: StatMod['type'];
  value: number;
  // What in the build gave it.
  from?: string;
}

// Where stats come from matters for augments and jewels: Augment Effect and Jewel Effect add a
// share of what those give on top.
export interface Source {
  kind: 'aura' | 'jewel' | 'other';
  stats: Exact[];
}
const EFFECT: Partial<Record<Source['kind'], string>> = { aura: 'aura_effect', jewel: 'jewel_effect' };

export interface Total {
  value: number;
  more: number;
}

// The game works in 32-bit floats and drops fractions in places, so the sums here do the same.
const f = Math.fround;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// How one stat came to its total: every stat that went into it, what those added up to before
// its limits, and what other stats then derived into it.
export interface Breakdown {
  // `as` is the stat it was given as, when that one hands itself over to this one.
  parts: (Exact & { as?: string })[];
  // Missing when nothing but derived stats went into it.
  sum?: { base: number; flat: number; percent: number; more: number; value: number };
  derived: { from: string; value: number }[];
  total: Total;
}

// StatCalculation.calc for a character that is casting nothing: support gems only count for their own skill.
export function totalStats(rules: StatRules, sources: Source[]): Map<string, Total> {
  return calculate(rules, sources).stats;
}

export function explainStat(rules: StatRules, sources: Source[], id: string): Breakdown {
  return calculate(rules, sources, id).breakdown;
}

function calculate(rules: StatRules, sources: Source[], watch?: string) {
  const calc = new Map<string, { flat: number; percent: number; multi: number }>();
  const entry = (id: string) => calc.get(id) ?? calc.set(id, { flat: 0, percent: 0, multi: 1 }).get(id)!;
  const breakdown: Breakdown = { parts: [], derived: [], total: { value: 0, more: 1 } };
  let handing = true;
  const add = (mod: Exact) => {
    const { id, type, value } = mod;
    if (watch && id === watch) breakdown.parts.push(mod);
    else if (watch && handing && rules.transfers[id]?.includes(watch)) breakdown.parts.push({ ...mod, as: rules.defs[id]?.name ?? id });
    const e = entry(id);
    if (type === 'FLAT') e.flat = f(e.flat + value);
    else if (type === 'PERCENT') e.percent = f(e.percent + value);
    else e.multi = f(e.multi * f(1 + value / 100));
  };

  const all = sources.flatMap((source) => source.stats);
  all.forEach(add);
  for (const { kind, stats } of sources) {
    const share = all.filter((mod) => mod.id === EFFECT[kind]).reduce((sum, mod) => sum + mod.value, 0) / 100;
    if (share) stats.forEach((mod) => add({ ...mod, value: f(mod.value * share), from: `${mod.from ?? 'Other'}, through ${rules.defs[EFFECT[kind]!].name}` }));
  }

  for (const [id, from] of [...calc]) {
    if (!rules.transfers[id]) continue;
    for (const to of rules.transfers[id]) {
      const e = entry(to);
      e.flat = f(e.flat + from.flat);
      e.percent = f(e.percent + from.percent);
      // InCalcStatData.addFullyTo: a "more" multiplier is handed over as a difference.
      e.multi = f(e.multi + 1 - from.multi);
    }
    calc.delete(id);
  }
  handing = false;

  const finish = () =>
    new Map(
      [...calc].map(([id, e]): [string, Total] => {
        const def = rules.defs[id];
        const value = f(f(def.base + e.flat) * f(1 + e.percent / 100));
        return [id, { value: clamp(def.apart ? value : f(value * e.multi), def.min, def.max), more: def.apart ? e.multi : 1 }];
      }),
    );

  // Attributes give their stats for every whole point, counted before those stats are in.
  const first = finish();
  for (const [id, mods] of Object.entries(rules.core)) {
    if (!first.has(id)) continue;
    const points = Math.trunc(first.get(id)!.value);
    for (const mod of mods) add({ id: mod.id, type: mod.type, value: f(points * mod.min), from: `${points} ${rules.defs[id].name}` });
  }

  // Derived stats read from a copy, taken afresh each time the priority goes up, and add to the real thing.
  const stats = finish();
  const e = watch && calc.get(watch);
  if (e) {
    const def = rules.defs[watch];
    const value = f(f(def.base + e.flat) * f(1 + e.percent / 100));
    breakdown.sum = { base: def.base, flat: e.flat, percent: e.percent, more: e.multi, value: def.apart ? value : f(value * e.multi) };
  }
  const copied = () => new Map([...stats].map(([id, total]) => [id, { ...total }]));
  let copy = copied();
  let last: number | undefined;
  for (const d of rules.derived.filter((d) => first.has(d.id)).sort((a, b) => a.priority - b.priority)) {
    if (last !== undefined && d.priority > last) copy = copied();
    last = d.priority;
    const from = copy.get(d.from)?.value ?? 0;
    const amount = d.per ? Math.trunc(from / d.per) * first.get(d.id)!.value : from * ((copy.get(d.id)?.value ?? 0) / 100);
    const to = stats.get(d.to) ?? stats.set(d.to, { value: 0, more: 1 }).get(d.to)!;
    to.value = clamp(f(to.value + amount), rules.defs[d.to].min, rules.defs[d.to].max);
    if (d.to === watch && amount) {
      const of = rules.defs[d.from]?.name ?? d.from;
      const by = +(d.per ? first.get(d.id)!.value : (copy.get(d.id)?.value ?? 0)).toFixed(2);
      breakdown.derived.push({ from: d.per ? `${by} for every ${d.per} ${of}` : `${by}% of ${Math.round(from).toLocaleString('en')} ${of}`, value: amount });
    }
  }
  if (watch) breakdown.total = stats.get(watch) ?? breakdown.total;
  return { stats, breakdown };
}

// GemInventoryHelper.getTotalSpirit: capacity that works out below 1 falls back to what everyone starts with.
export function augmentCapacity(rules: StatRules, stats: Map<string, Total>): number {
  const capacity = Math.trunc(stats.get('spirit_cost')?.value ?? 0);
  return capacity < 1 ? rules.defs.spirit_cost.base : capacity;
}

// GemInventoryHelper.getSpiritReserved: each augment has a stat of its own that changes what it takes up.
export function augmentCost(stats: Map<string, Total>, aura: { id: string; reserves: number }): number {
  const change = stats.get(`${aura.id}_aura_cost`)?.value ?? 0;
  return Math.trunc(f(aura.reserves * f(1 + change / 100)));
}

// SpellCastingData.calcSpellLevels: a learned skill gains the levels that stats give to all skills
// and to skills of its tags, up to a cap. They count for what the skill does, not for its support slots.
export function bonusSkillLevels(stats: Map<string, Total>, tags: string[], max: number): number {
  const levels = ['all', ...tags].reduce((sum, tag) => Math.trunc(sum + (stats.get(`plus_lvl_${tag}_spells`)?.value ?? 0)), 0);
  return clamp(levels, 0, max);
}

// PlayerStatUtils.addNewbieElementalResists, which the pack leaves on (ENABLE_MINUS_RESISTS_PER_LEVEL).
export function newbieResists(level: number): Exact[] {
  const value = level > 74 ? -25 : level > 49 ? 0 : level > 24 ? 25 : 50;
  return ['fire', 'water', 'lightning', 'chaos'].map((element) => ({ id: `${element}_resist`, type: 'FLAT', value }));
}

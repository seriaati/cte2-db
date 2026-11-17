// Client-safe types and game rules for the gear planner. Like affix.ts, no data imports here.
import { formatStat, rolled, type Affix, type Base, type Rarity, type StatMod } from './affix';
import type { Gem } from './gems';
import type { Rune } from './runes';

export interface PlanBase extends Base {
  stats: StatMod[];
}

export interface PlanAffix extends Affix {
  // A few affixes may sit on one item more than once (only_one_per_item is false).
  repeatable: boolean;
}

export interface PlanRarity extends Rarity {
  affixCount: number;
  baseMinPercent: number;
  baseMaxPercent: number;
  // The most sockets gear of this rarity can have, and how many of them may hold gems or runes.
  sockets: number;
  maxGems: number;
  maxRunes: number;
  runewords: boolean;
}

// Stats one part of the item gives, with the roll window and level they are worked out at.
export interface Part {
  stats: StatMod[];
  rolls: Rarity;
  level: number;
}

export type Socketed = { kind: 'gem'; item: Gem } | { kind: 'rune'; item: Rune };

// Runes and gems give different stats by the kind of gear; off-hand gear counts as armor.
const kindOf = (base: PlanBase) => (base.family === 'Weapon' ? 'Weapon' : base.family === 'Jewelry' ? 'Jewelry' : 'Armor');

// A rune rolls anywhere in its range and grows with the gear's level; a gem's value is fixed.
export function socketPart(socketed: Socketed, base: PlanBase, rolls: Rarity, level: number): Part {
  return { stats: socketed.item.stats[kindOf(base)], rolls, level: socketed.kind === 'rune' ? level : 1 };
}

// Whether the name or a stat line, as shown, contains the lower-case search text.
export function matches(query: string, name: string, { stats, rolls, level }: Part) {
  const lines = stats.map((stat) => formatStat(stat, rolls, level)).map((line) => `${line.value} ${line.label}`);
  return [name, ...lines].some((text) => text.toLowerCase().includes(query));
}

// Mirrors BaseStatsData.GetAllStats: Gear's Defense and Gear's Weapon Damage on any other part
// change the matching base stats. Flat amounts are added first, then each percentage multiplies.
export const MODIFIES: Record<string, string[]> = {
  gear_defense: ['armor', 'dodge', 'magic_shield'],
  gear_weapon_damage: ['weapon_damage'],
};

const modifiers = (stat: StatMod, others: Part[]) =>
  others.flatMap((p) => p.stats.filter((s) => MODIFIES[s.id]?.includes(stat.id)).map((s) => ({ s, p })));

export const changesBase = (base: Part, others: Part[]) => base.stats.some((stat) => modifiers(stat, others).length > 0);

export function baseRange(stat: StatMod, base: Part, others: Part[]): [number, number] {
  const mods = modifiers(stat, others);
  const at = (end: 'minPercent' | 'maxPercent') => {
    const value = (type: string) => mods.filter((m) => m.s.type === type).map((m) => rolled(m.s, m.p.rolls[end], m.p.level));
    const flat = value('FLAT').reduce((sum, v) => sum + v, rolled(stat, base.rolls[end], base.level));
    return value('PERCENT').reduce((total, v) => total * (1 + v / 100), flat);
  };
  return [at('minPercent'), at('maxPercent')];
}

// Mirrors RuneWord.hasMatchingRunesToCreate: the runeword's runes must sit next to each other, in
// order, among the socketed runes. The longest match wins.
export function formedRuneword<T extends { runes: string[]; slots: string[] }>(runewords: T[], runes: string[], slot: string): T | undefined {
  const socketed = runes.join(',');
  return runewords
    .filter((w) => w.slots.includes(slot) && `,${socketed},`.includes(`,${w.runes.join(',')},`))
    .sort((a, b) => b.runes.length - a.runes.length)[0];
}

// Mirrors GearAffixesData.randomize: half of each, and an odd one out becomes a prefix.
export function slotCount(rarity: PlanRarity, type: 'prefix' | 'suffix'): number {
  return type === 'prefix' ? Math.ceil(rarity.affixCount / 2) : Math.floor(rarity.affixCount / 2);
}

// Each part of an item rolls inside its own share of a stat's range. Base stats use the rarity's
// base_stat_percents, implicits always 0-100, and an affix the stat_percents of its own tier,
// which is at best the item's rarity.
export function rollWindows(rarity: PlanRarity): Record<'base' | 'implicit' | 'affix', Rarity> {
  return {
    base: { ...rarity, minPercent: rarity.baseMinPercent, maxPercent: rarity.baseMaxPercent },
    implicit: { ...rarity, minPercent: 0, maxPercent: 100 },
    affix: rarity,
  };
}

// What a planner link carries, by id. Sockets are "gem:<id>" or "rune:<id>", in socket order.
export interface Plan {
  base: string;
  rarity: string;
  level: number;
  implicit?: string;
  prefix: string[];
  suffix: string[];
  sockets: string[];
  infusion?: string;
  infusionRarity?: string;
}

// The part of a planner link after the #. The planner page reads it back.
export function encodePlan({ base, rarity, level, implicit, prefix, suffix, sockets, infusion, infusionRarity }: Plan): string {
  const link = new URLSearchParams({ base, rarity, level: `${level}` });
  const parts = { implicit, prefix: prefix.join(), suffix: suffix.join(), sockets: sockets.join(), infusion, infusionRarity: infusion && infusionRarity };
  for (const [key, value] of Object.entries(parts)) if (value) link.set(key, value);
  return `${link}`;
}

// Mirrors GearItemData.getFullAffixedName: an implicit's name stands in for the base name, and
// every gear_item_name_* format in lang.json joins the parts with spaces.
export function itemName(base: Base, implicit?: Affix, prefix?: Affix, suffix?: Affix): string {
  return [prefix?.name, implicit?.name ?? base.name, suffix?.name].filter(Boolean).join(' ');
}

// Client-safe types and game rules for the gear planner. Like affix.ts, no data imports here.
import { rolled, type Affix, type Base, type Rarity, type StatMod } from './affix';

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

// Mirrors BaseStatsData.GetAllStats: Gear's Defense and Gear's Weapon Damage on any other part
// change the matching base stats. Flat amounts are added first, then each percentage multiplies.
const MODIFIES: Record<string, string[]> = {
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

// Mirrors GearItemData.getFullAffixedName: an implicit's name stands in for the base name, and
// every gear_item_name_* format in lang.json joins the parts with spaces.
export function itemName(base: Base, implicit?: Affix, prefix?: Affix, suffix?: Affix): string {
  return [prefix?.name, implicit?.name ?? base.name, suffix?.name].filter(Boolean).join(' ');
}

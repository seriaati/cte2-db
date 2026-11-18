// Client-safe types and game rules for the build editor. Like affix.ts, no data imports here.
import type { Rarity, StatMod } from './affix';

export const TREES = ['talents', 'ascendancy', 'atlas'] as const;
export type TreeId = (typeof TREES)[number];
// Everything a character has points to spend on.
export type Pool = TreeId | 'spells' | 'passives' | 'stats';
export const POOLS: Pool[] = [...TREES, 'spells', 'passives', 'stats'];

export interface Points {
  base: number;
  perLevel: number;
  maxBonus: number;
  maxTotal: number;
}

// PlayerPointsType.getFreePoints in Mine and Slash, before any are spent.
export const pointsAt = (p: Points, level: number, bonus: number) => Math.min(p.maxTotal, p.base + Math.trunc(level * p.perLevel) + bonus);

type Fits = (base: { family: string; slot: string; dualWield: boolean }) => boolean;
const slot = (id: string): Fits => (base) => base.slot === id;

// Where gear is worn, and the kind of gear whose icon stands for the slot. The off hand also takes
// a second weapon when it is one that can be dual wielded, which the game counts at a quarter strength.
export const GEAR_SLOTS = [
  { id: 'weapon', name: 'Weapon', icon: 'sword', fits: ((base) => base.family === 'Weapon') as Fits },
  { id: 'offhand', name: 'Off hand', icon: 'shield', fits: ((base) => base.family === 'OffHand' || base.dualWield) as Fits },
  { id: 'helmet', name: 'Helmet', icon: 'helmet', fits: slot('helmet') },
  { id: 'chest', name: 'Chestplate', icon: 'chest', fits: slot('chest') },
  { id: 'pants', name: 'Pants', icon: 'pants', fits: slot('pants') },
  { id: 'boots', name: 'Boots', icon: 'boots', fits: slot('boots') },
  { id: 'necklace', name: 'Necklace', icon: 'necklace', fits: slot('necklace') },
  { id: 'ring1', name: 'Ring 1', icon: 'ring', fits: slot('ring') },
  { id: 'ring2', name: 'Ring 2', icon: 'ring', fits: slot('ring') },
  { id: 'elytra', name: 'Elytra', icon: 'elytra', fits: slot('elytra') },
] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number]['id'];

// A roll is a percentage of the stat's range. One left out is the best the part can roll.
export interface Rolled {
  id: string;
  roll?: number;
}

export interface Socket extends Rolled {
  kind: 'gem' | 'rune';
}

export interface Item {
  base: string;
  // Set for a unique, whose rarity is then "unique".
  unique?: string;
  rarity: string;
  level: number;
  baseRoll?: number;
  implicit?: Rolled;
  prefix: Rolled[];
  suffix: Rolled[];
  // One roll for each of a unique's stats, in order.
  uniqueRolls?: number[];
  sockets: Socket[];
  runewordRoll?: number;
  infusion?: { id: string; rarity: string };
  // The kind is what the corruption did to the item: how many affixes and sockets it added.
  corruption?: { kind: string; affixes: Rolled[] };
  enchants: { id: string; level: number }[];
}

export const RARITY_TYPES = ['normal', 'unique', 'runed'] as const;
export type RarityType = (typeof RARITY_TYPES)[number];

export interface Codex {
  id: string;
  rarity: string;
  level: number;
  // How many pieces of each kind of gear it asks for, and the slots it wants a certain kind in.
  pieces: Record<RarityType, number>;
  slots: { slot: string; type: RarityType }[];
  affixes: string[];
}

export const JEWEL_KINDS = ['str', 'dex', 'int', 'crafted', 'eye'] as const;

export interface Jewel {
  kind: (typeof JEWEL_KINDS)[number];
  rarity: string;
  level: number;
  affixes: Rolled[];
  corruption: Rolled[];
}

export interface Skill {
  spell: string;
  supports: Rolled[];
}

export const RESISTS = ['fire', 'water', 'lightning', 'chaos'];

export interface Build {
  name: string;
  level: number;
  // Points on top of what the level gives, from quests and the like.
  bonus: Record<Pool, number>;
  // Indexes into each tree's nodes.
  trees: Record<TreeId, number[]>;
  // Points put in each attribute.
  stats: Record<string, number>;
  classes: string[];
  // Levels of class spells and passives, by perk id.
  perks: Record<string, number>;
  hotbar: (Skill | null)[];
  gear: Partial<Record<GearSlot, Item>>;
  codex: Codex | null;
  augments: Rolled[];
  jewels: Jewel[];
  // What damage is worked out for: a skill on the hotbar, or the basic attack when empty. The
  // basic attacks a second are the weapon's own unless set, and area and piercing hits land on
  // TARGETS.standard enemies unless `targets` says how many.
  damage: { skill: string; attacks?: number; targets?: number };
  // The enemy damage and defenses are worked out against: a mob of the character's own level
  // unless one is set, with its rarity and one affix or none for each it rolls.
  enemy: { level?: number; rarity: string; affixes: string[] };
  // What a common mob's hit is before defenses, and how many hits land a second.
  defense: { hit: number; rate: number };
  // The Retribution stacks a Crusader is taken to hold.
  retribution: number;
  // The aura skill that is on, of the ones the build has learned: only one can be at a time.
  aura: string;
  // The effects taken to be on, of the ones the build's skills and stats can put on the
  // character or on the enemy, with the stacks of each.
  effects: Record<string, number>;
}

// GemInventoryHelper in Mine and Slash 6.4.13.
export const HOTBAR_SLOTS = 8;
export const SUPPORT_SLOTS = 5;
export const AUGMENT_SLOTS = 9;
const RANKS_PER_SUPPORT_SLOT = 4;
// JewelSocketStat's cap.
export const MAX_JEWELS = 9;
export const MAX_CLASSES = 2;
// SpellSchoolsData: what a character with a single class gets, as percentages.
export const SOLO_CLASS = { moreDamage: 10, damageReduction: 5 };
// A player's hit points before any mod adds to them, which the game counts into health.
export const VANILLA_HEALTH = 20;
// PERC_OFFHAND_WEP_STAT in the pack's server config: the share of its stats a weapon gives from the off hand.
export const OFFHAND_WEAPON_PERCENT = 25;
const ENEMY = { rarity: 'common', affixes: [] };
const MOB_HITS = { hit: 1000, rate: 2 };
// The pack's effect that Crusader skills spend, and the class that gains it.
export const RETRIBUTION = { effect: 'retribution', class: 'crusader' };
// How many enemies area and piercing hits land on.
export const TARGETS = { standard: 3, max: 20 };

export interface Limits {
  maxLevel: number;
  points: Record<Pool, Points>;
}

export const emptyBuild = ({ maxLevel, points }: Limits, name = 'New build'): Build => ({
  name,
  level: maxLevel,
  // Pools that give nothing per level are planned with every point they can ever have.
  bonus: Object.fromEntries(POOLS.map((pool) => [pool, points[pool].perLevel ? 0 : points[pool].maxBonus])) as Build['bonus'],
  trees: { talents: [], ascendancy: [], atlas: [] },
  stats: {},
  classes: [],
  perks: {},
  hotbar: Array.from({ length: HOTBAR_SLOTS }, () => null),
  gear: {},
  codex: null,
  augments: [],
  jewels: [],
  damage: { skill: '' },
  enemy: ENEMY,
  defense: MOB_HITS,
  retribution: 0,
  aura: '',
  effects: {},
});

// SpellSchool.isLevelEnoughFor and isLevelEnoughForSpellLevelUp: a perk opens at its row's level,
// and each further level of it needs one more character level.
export const maxRank = (perk: { level: number; maxLevel: number }, level: number) => Math.max(0, Math.min(perk.maxLevel, level - perk.level + 1));

// InsertedSpell.getData and GameBalanceConfig.getMaxLinksForLevel: a skill's support slots open
// with its own level and with the character's.
export const supportSlots = (rank: number, level: number, linkLevels: number[]) =>
  Math.min(SUPPORT_SLOTS, Math.trunc(rank / RANKS_PER_SUPPORT_SLOT), linkLevels.filter((l) => level >= l).length);

// JewelItemData.generateAffixes.
export const jewelAffixes = (affixCount: number) => 1 + Math.trunc(affixCount / 2);

export const rollIn = (roll: number | undefined, window: { minPercent: number; maxPercent: number }) =>
  roll === undefined ? window.maxPercent : Math.min(window.maxPercent, Math.max(window.minPercent, roll));

// StatRequirement.getScalingReq: what gear of a level asks of each attribute. The pack's
// STAT_REQUIREMENTS_MULTIPLIER is 1 in ORIGINAL_MODE.
export const needsAt = <T extends { factor: number }>(needs: T[], curve: { base: number; perLevel: number }, level: number) =>
  needs.map((n) => ({ ...n, value: Math.floor(n.factor * (curve.base + curve.perLevel * (level - 1))) }));

// A roll window that is a single point, for showing a part at its exact roll.
export const exactly = (percent: number): Rarity => ({ id: '', name: '', color: '', ink: '', minPercent: percent, maxPercent: percent });

// OmenData.getStatPercent: the more a codex asks for, the more it gives.
export const codexPercent = (codex: Codex, statMulti: number) =>
  Math.trunc(Math.fround((RARITY_TYPES.reduce((sum, type) => sum + codex.pieces[type], 0) + codex.slots.length) * 10 * Math.fround(statMulti)));

// OmenSet: wearing every piece gives the codex's own stats, and each affix comes one piece
// earlier than the last, never below two pieces.
export function codexBonuses<T>(codex: Codex, mods: StatMod[], affixes: T[]): { pieces: number; mods?: StatMod[]; affix?: T }[] {
  const total = RARITY_TYPES.reduce((sum, type) => sum + codex.pieces[type], 0);
  const steps = new Map<number, { pieces: number; mods?: StatMod[]; affix?: T }>([[total, { pieces: total, mods }]]);
  let at = total - 1;
  for (const affix of affixes) {
    steps.set(at, { ...steps.get(at), pieces: at, affix });
    at = Math.max(2, at - 1);
  }
  return [...steps.values()].sort((a, b) => a.pieces - b.pieces);
}

// Reading a build that came from a file, a link or storage: anything out of shape is dropped.
// Ids are not checked here; the editor leaves out what the current pack doesn't have.
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, min: number, max: number, fallback = min) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback;
const id = (v: unknown) => (typeof v === 'string' ? v.slice(0, 100) : '');
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const roll = (v: unknown) => (typeof v === 'number' ? int(v, 0, 100) : undefined);
const rolled = (v: unknown, max: number): Rolled[] => list(v, max).flatMap((e) => (isObject(e) && id(e.id) ? [{ id: id(e.id), roll: roll(e.roll) }] : []));
const oneOf = <T extends string>(v: unknown, options: readonly T[]): T | undefined => options.find((o) => o === v);

function readItem(v: unknown, maxLevel: number): Item | null {
  if (!isObject(v) || !id(v.base) || !id(v.rarity)) return null;
  const { infusion, corruption } = v;
  return {
    base: id(v.base),
    unique: id(v.unique) || undefined,
    rarity: id(v.rarity),
    level: int(v.level, 1, maxLevel, maxLevel),
    baseRoll: roll(v.baseRoll),
    implicit: rolled([v.implicit], 1)[0],
    prefix: rolled(v.prefix, 6),
    suffix: rolled(v.suffix, 6),
    uniqueRolls: Array.isArray(v.uniqueRolls) ? list(v.uniqueRolls, 12).map((r) => int(r, 0, 100, 100)) : undefined,
    sockets: list(v.sockets, 8).flatMap((s) => {
      const kind = isObject(s) && oneOf(s.kind, ['gem', 'rune'] as const);
      return kind && id(s.id) ? [{ kind, id: id(s.id), roll: roll(s.roll) }] : [];
    }),
    runewordRoll: roll(v.runewordRoll),
    infusion: isObject(infusion) && id(infusion.id) ? { id: id(infusion.id), rarity: id(infusion.rarity) } : undefined,
    corruption: isObject(corruption) && id(corruption.kind) ? { kind: id(corruption.kind), affixes: rolled(corruption.affixes, 4) } : undefined,
    enchants: list(v.enchants, 30).flatMap((e) => (isObject(e) && id(e.id) ? [{ id: id(e.id), level: int(e.level, 1, 10) }] : [])),
  };
}

function readCodex(v: unknown, maxLevel: number): Codex | null {
  if (!isObject(v) || !id(v.id)) return null;
  const pieces = isObject(v.pieces) ? v.pieces : {};
  return {
    id: id(v.id),
    rarity: id(v.rarity),
    level: int(v.level, 1, maxLevel, maxLevel),
    pieces: Object.fromEntries(RARITY_TYPES.map((type) => [type, int(pieces[type], 0, 5, 1)])) as Codex['pieces'],
    slots: list(v.slots, 5).flatMap((s) => {
      const type = isObject(s) && oneOf(s.type, RARITY_TYPES);
      return type && id(s.slot) ? [{ slot: id(s.slot), type }] : [];
    }),
    affixes: list(v.affixes, 5).map(id).filter(Boolean),
  };
}

function readDamage(v: unknown): Build['damage'] {
  const damage = isObject(v) ? v : {};
  return {
    skill: id(damage.skill),
    attacks: typeof damage.attacks === 'number' && damage.attacks > 0 ? Math.min(20, damage.attacks) : undefined,
    targets: typeof damage.targets === 'number' ? int(damage.targets, 1, TARGETS.max) : undefined,
  };
}

// A build saved before both tabs had the one enemy kept it with the Defense tab's settings, and
// a level of its own for the Damage tab's target.
function readEnemy(v: Record<string, unknown>, maxLevel: number): Build['enemy'] {
  const enemy = isObject(v.enemy) ? v.enemy : isObject(v.defense) ? v.defense : {};
  const level = enemy.level ?? (isObject(v.damage) && isObject(v.damage.target) ? v.damage.target.level : undefined);
  return {
    level: typeof level === 'number' ? int(level, 1, maxLevel) : undefined,
    rarity: id(enemy.rarity) || ENEMY.rarity,
    affixes: list(enemy.affixes, 4).map(id),
  };
}

function readDefense(v: unknown): Build['defense'] {
  const defense = isObject(v) ? v : {};
  return { hit: int(defense.hit, 1, 100000000, MOB_HITS.hit), rate: int(defense.rate, 1, 20, MOB_HITS.rate) };
}

export function readBuild(v: unknown, limits: Limits): Build | null {
  if (!isObject(v)) return null;
  const empty = emptyBuild(limits);
  const { maxLevel, points } = limits;
  const bonus = isObject(v.bonus) ? v.bonus : {};
  const trees = isObject(v.trees) ? v.trees : {};
  const record = (value: unknown, max: number) =>
    Object.fromEntries(
      Object.entries(isObject(value) ? value : {})
        .slice(0, 200)
        .map(([key, n]) => [id(key), int(n, 0, max)] as const)
        .filter(([key, n]) => key && n > 0),
    );
  const hotbar = list(v.hotbar, HOTBAR_SLOTS).map((s) => (isObject(s) && id(s.spell) ? { spell: id(s.spell), supports: rolled(s.supports, SUPPORT_SLOTS) } : null));
  return {
    name: (typeof v.name === 'string' && v.name.trim().slice(0, 60)) || empty.name,
    level: int(v.level, 1, maxLevel, maxLevel),
    bonus: Object.fromEntries(POOLS.map((pool) => [pool, int(bonus[pool], 0, points[pool].maxBonus, empty.bonus[pool])])) as Build['bonus'],
    trees: Object.fromEntries(TREES.map((tree) => [tree, [...new Set(list(trees[tree], 2000).map((n) => int(n, 0, 100000)))]])) as Build['trees'],
    stats: record(v.stats, points.stats.maxTotal),
    classes: [...new Set(list(v.classes, MAX_CLASSES).map(id).filter(Boolean))],
    perks: record(v.perks, 100),
    hotbar: [...hotbar, ...empty.hotbar].slice(0, HOTBAR_SLOTS),
    gear: Object.fromEntries(
      GEAR_SLOTS.flatMap(({ id: key }) => {
        const item = isObject(v.gear) && readItem(v.gear[key], maxLevel);
        return item ? [[key, item]] : [];
      }),
    ),
    codex: readCodex(v.codex, maxLevel),
    augments: rolled(v.augments, AUGMENT_SLOTS),
    jewels: list(v.jewels, MAX_JEWELS).flatMap((j) => {
      const kind = isObject(j) && oneOf(j.kind, JEWEL_KINDS);
      return kind ? [{ kind, rarity: id(j.rarity), level: int(j.level, 1, maxLevel, maxLevel), affixes: rolled(j.affixes, 8), corruption: rolled(j.corruption, 2) }] : [];
    }),
    damage: readDamage(v.damage),
    enemy: readEnemy(v, maxLevel),
    defense: readDefense(v.defense),
    retribution: int(v.retribution, 0, 100),
    aura: id(v.aura),
    effects: record(v.effects, 100),
  };
}

const FORMAT = 'cte2-build';

// The file a build is exported to. The pack version says which release its ids are from.
export const exportBuild = (build: Build, pack: string) => JSON.stringify({ format: FORMAT, version: 1, pack, build }, null, 2);

export function importBuild(text: string, limits: Limits): Build | null {
  try {
    const data = JSON.parse(text);
    return data?.format === FORMAT ? readBuild(data.build, limits) : null;
  } catch {
    return null;
  }
}

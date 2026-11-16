// Build-time only: the game data the build editor works with. The page gets `core` with its HTML
// and fetches each of `sections` the first time the part of the editor that needs it is opened.
import affixData from '../data/affixes.json';
import baseData from '../data/base_gear_types.json';
import balanceData from '../data/game_balance.json';
import chaosData from '../data/chaos_stat.json';
import iconData from '../data/gear_icons.json';
import rarityData from '../data/gear_rarity.json';
import omenData from '../data/omen.json';
import packData from '../data/pack.json';
import perkData from '../data/perk.json';
import schoolData from '../data/spell_school.json';
import statData from '../data/stat.json';
import compatData from '../data/stat_compat.json';
import uniqueData from '../data/unique_gears.json';
import type { Affix, StatMod } from './affix';
import { auras } from './auras';
import type { Limits, RarityType, TreeId } from './buildRules';
import { affixesOf, infusions, maxLevel, statMod, tagNames, text } from './gear';
import { gems, ranks } from './gems';
import { sprite } from './items';
import { abyssalEye, craftedJewel, jewelAffixes, jewelKinds } from './jewels';
import { planAffixes, planBases, planRarities, planRarity } from './planner';
import { runes, runewords, slotNames } from './runes';
import { bonusLevels, costScaling, spells } from './spells';
import { supports } from './supports';
import { ascendancy, atlas, talents } from './talents';
import { uniqueRarity, uniques } from './uniques';

const balance = balanceData.original_balance;
const trees = { talents, ascendancy, atlas };

const pool = (type: 'SPELLS' | 'PASSIVES' | 'STATS') => {
  const p = balance.player_points[type];
  return { base: p.base_points, perLevel: p.points_per_lvl, maxBonus: p.max_bonus_points, maxTotal: p.max_total_points };
};

const limits: Limits = {
  maxLevel,
  points: { talents: talents.points, ascendancy: ascendancy.points, atlas: atlas.points, spells: pool('SPELLS'), passives: pool('PASSIVES'), stats: pool('STATS') },
};

const SOCKET_STAT = 'jewel_socket';

export const core = {
  ...limits,
  pack: packData.version,
  attributes: Object.entries(statData as Record<string, { ser?: string }>)
    .filter(([, stat]) => stat.ser === 'core_stat')
    .map(([id]) => ({ id, name: text(`mmorpg.stat.${id}`, id), desc: text(`mmorpg.stat_desc.${id}`, '') })),
  // The character level each of a skill's five support slots opens at.
  linkLevels: [balance.link_1_lvl, balance.link_2_lvl, balance.link_3_lvl, balance.link_4_lvl, balance.link_5_lvl],
  // Jewel sockets come from a few talents and uniques: for each tree the nodes that give one, and
  // for each such unique the stat that does.
  jewelSockets: {
    trees: Object.fromEntries(
      Object.entries(trees).map(([id, tree]) => [id, tree.nodes.flatMap(([, , perk], node) => (tree.perks[perk].stats.some((s) => s.id === SOCKET_STAT) ? [node] : []))]),
    ) as Record<TreeId, number[]>,
    uniques: Object.fromEntries(uniques.flatMap((u) => u.stats.flatMap((s, i) => (s.id === SOCKET_STAT ? [[u.id, { stat: i, min: s.min, max: s.max }]] : [])))) as Record<
      string,
      { stat: number; min: number; max: number }
    >,
  },
};
export type Core = typeof core;

const affixName = (affix: Affix) => ({ ...affix, name: affix.name === affix.id ? '' : affix.name });
const rawAffixes = affixData as Record<string, { requirements: { tag_requirements: { included: string[] }[] } }>;

// Vanilla enchantments have no names in the pack's own files, and they are plain enough to rebuild from the id.
const enchantName = (id: string) =>
  id
    .split(':')[1]
    .split('_')
    .map((word, i) => (i && ['of', 'the'].includes(word) ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ');

const rarityTypes: Record<string, RarityType> = { NORMAL: 'normal', UNIQUE: 'unique', RUNED: 'runed' };
type Range = { min: number; max: number };
const rawRarities = rarityData as Record<string, { type: string; item_tier: number; omens: { stat_multi: number; affixes: Range; specific_slots: Range; normal: Range; unique: Range; runed: Range } }>;

// The item a base is at each rarity, as a picture. The game picks among the base's items the
// rarity is high enough for, each ten times likelier than the one before, so the last stands for it.
const gearIcons = iconData as Record<string, string>;
const rawBases = baseData as Record<string, { possible_items: { item_id: string; min_rar: string }[] }>;
const sprites = (baseId: string) =>
  Object.fromEntries(
    Object.entries(rawRarities).map(([rarity, { item_tier }]) => [
      rarity,
      rawBases[baseId].possible_items.filter((item) => rawRarities[item.min_rar].item_tier <= item_tier && item.item_id in gearIcons).map((item) => gearIcons[item.item_id]).at(-1) ?? '',
    ]),
  );
const rawUniques = uniqueData as Record<string, { force_item_id: string }>;

const gear = {
  bases: planBases.map((base) => ({ ...base, sprites: sprites(base.id) })),
  rarities: planRarities,
  uniqueRarity: planRarity(uniqueRarity),
  affixes: planAffixes,
  infusions,
  runes,
  gems,
  ranks,
  runewords,
  tagNames,
  slotNames,
  // A unique is its base's item unless it has one of its own.
  uniques: uniques
    .filter((u) => planBases.some((b) => b.id === u.base))
    .map(({ id, name, base, stats }) => ({ id, name, base, stats, sprite: gearIcons[rawUniques[id].force_item_id] ?? sprites(base).unique })),
  // What corrupting an item can do to it (ChaosStat in Mine and Slash), and the affixes it draws from.
  corruption: {
    kinds: Object.values(chaosData).map((c) => ({ id: c.id, name: c.name, affixes: c.affix_number, sockets: c.bonus_sockets, rarities: c.for_item_rarities })),
    affixes: affixesOf(['chaos_stat']).map(affixName),
  },
  // The enchantments the pack turns into Mine and Slash stats, a fixed amount per level up to a cap per item.
  enchants: Object.values(compatData)
    .filter((c) => c.enchant_id)
    .map((c) => ({
      id: c.enchant_id,
      name: enchantName(c.enchant_id),
      stat: statMod({ stat: c.mns_stat_id, type: c.mod_type, min: c.conversion, max: c.conversion }),
      itemMin: c.per_item_min,
      itemMax: c.per_item_max,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  codex: {
    icon: sprite('mmorpg:omen'),
    kinds: Object.values(omenData).map((o) => ({ id: o.id, name: text(`mmorpg.omen.${o.id}`, o.id), mods: o.mods.map(statMod), affixTypes: o.affix_types })),
    // OmenBlueprint leaves out the affixes that are for weapons.
    affixes: affixesOf(['chaos_stat', 'jewel_corruption'])
      .filter((a) => !rawAffixes[a.id].requirements.tag_requirements.every((req) => req.included.includes('weapon_family')))
      .map(affixName),
    // By rarity: what scales its stats, how many affixes and slot conditions it can come with, and
    // how many pieces of each kind of gear it can ask for.
    rarities: Object.fromEntries(
      Object.entries(rawRarities).map(([id, { omens }]) => [
        id,
        { statMulti: omens.stat_multi, affixes: omens.affixes.max, slots: omens.specific_slots.max, pieces: { normal: omens.normal, unique: omens.unique, runed: omens.runed } },
      ]),
    ),
  },
  rarityTypes: Object.fromEntries(Object.entries(rawRarities).map(([id, r]) => [id, rarityTypes[r.type]])),
};

interface RawPerk {
  max_lvls: number;
  stats: { stat: string; type: string; v1: number; scale_to_lvl: boolean }[];
}
const rawPerks = perkData as unknown as Record<string, RawPerk>;
const classSpells = new Map(spells.map((s) => [s.id, s]));

const skills = {
  // A class lays its perks out on a grid: spells on the left, passives on the right, and each row
  // opens at its own character level.
  classes: Object.values(schoolData).map((school) => ({
    id: school.id,
    name: text(`mmorpg.asc_class.${school.id}`, school.id),
    icon: `/classes/${school.id}.webp`,
    perks: Object.entries(school.perks as Record<string, { x: number; y: number }>).map(([id, { x, y }]) => ({
      id,
      x,
      y,
      level: school.lvl_reqs[y],
      maxLevel: rawPerks[id].max_lvls,
      icon: `/spells/${id}.webp`,
      spell: classSpells.get(id) ?? null,
      // What one level of a passive gives; every level adds as much again (SpellSchoolsData.getStatAndContext).
      stats: classSpells.has(id)
        ? []
        : rawPerks[id].stats.map((s): StatMod => {
            const mod = statMod({ stat: s.stat, type: s.type, min: s.v1, max: s.v1 });
            return { ...mod, scaling: s.scale_to_lvl ? mod.scaling : null };
          }),
    })),
  })),
  supports,
  bonusLevels,
  costScaling,
};

const sockets = {
  auras,
  rarities: planRarities.filter((r) => !r.runewords),
  jewels: { kinds: jewelKinds, crafted: craftedJewel, eye: abyssalEye, affixes: jewelAffixes },
};

export const sections = { gear, skills, sockets, ...trees };
export type Sections = typeof sections;

// Build-time only: the game data the build editor works with. The page gets `core` with its HTML
// and fetches each of `sections` the first time the part of the editor that needs it is opened.
import affixData from '../data/affixes.json';
import baseData from '../data/base_gear_types.json';
import baseStatData from '../data/base_stats.json';
import balanceData from '../data/game_balance.json';
import chaosData from '../data/chaos_stat.json';
import effectData from '../data/exile_effect.json';
import iconData from '../data/gear_icons.json';
import rarityData from '../data/gear_rarity.json';
import omenData from '../data/omen.json';
import packData from '../data/pack.json';
import perkData from '../data/perk.json';
import setData from '../data/sets.json';
import schoolData from '../data/spell_school.json';
import statData from '../data/stat.json';
import compatData from '../data/stat_compat.json';
import talentIconData from '../data/talent_icons.json';
import uniqueData from '../data/unique_gears.json';
import weaponData from '../data/weapon_type.json';
import type { Affix, StatMod } from './affix';
import { auras } from './auras';
import { RETRIBUTION, VANILLA_HEALTH, type Limits, type RarityType, type TreeId } from './buildRules';
import { builtinLimits, transfers } from './builtinStats';
import { auraSkills, damage, skillEffects } from './damage';
import { defense } from './defense';
import { affixesOf, infusions, maxLevel, statMod, tagNames, text } from './gear';
import { gems, ranks } from './gems';
import { sprite } from './items';
import { abyssalEye, craftedJewel, jewelAffixes, jewelKinds } from './jewels';
import { planAffixes, planBases, planRarities, planRarity } from './planner';
import { runes, runewords, slotNames } from './runes';
import { bonusLevels, costScaling, spells } from './spells';
import type { Derived, StatDef, StatRules } from './statRules';
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
    // The game's icon for an attribute, which the talent icon sheet has a cell for because talents use it too.
    .map(([id]) => ({
      id,
      name: text(`mmorpg.stat.${id}`, id),
      desc: text(`mmorpg.stat_desc.${id}`, ''),
      icon: (talentIconData as Record<string, number>)[`mmorpg:textures/gui/stat_icons/core/${id}.png`],
    })),
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
const rawBases = baseData as Record<string, { weapon_type: string; possible_items: { item_id: string; min_rar: string }[] }>;
const weapons = weaponData as Record<string, { can_dual_wield: boolean }>;
const sprites = (baseId: string) =>
  Object.fromEntries(
    Object.entries(rawRarities).map(([rarity, { item_tier }]) => [
      rarity,
      rawBases[baseId].possible_items.filter((item) => rawRarities[item.min_rar].item_tier <= item_tier && item.item_id in gearIcons).map((item) => gearIcons[item.item_id]).at(-1) ?? '',
    ]),
  );
const rawUniques = uniqueData as Record<string, { force_item_id: string }>;

const gear = {
  // A weapon that can be dual wielded also goes in the off hand; one that can't takes both hands.
  bases: planBases.map((base) => ({ ...base, sprites: sprites(base.id), dualWield: weapons[rawBases[base.id].weapon_type].can_dual_wield })),
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
  // Wearing enough of a set's uniques gives each bonus that asks for that many or fewer.
  sets: Object.values(setData)
    .filter((set) => set.uniques.length)
    .map((set) => ({ name: text(`mmorpg.item_set.${set.id}`, set.id), uniques: set.uniques as string[], bonuses: set.bonuses.map((b) => ({ pieces: b.pieces, stats: b.stats.map(statMod) })) })),
  // What corrupting an item can do to it (ChaosStat in Mine and Slash), and the affixes it draws from.
  corruption: {
    kinds: Object.values(chaosData).map((c) => ({ id: c.id, name: c.name, affixes: c.affix_number, sockets: c.bonus_sockets, rarities: c.for_item_rarities })),
    affixes: affixesOf(['chaos_stat']).map(affixName),
  },
  // The enchantments the pack turns into Mine and Slash stats, a fixed amount per level up to a cap
  // per item, and another for all the gear worn together.
  enchants: Object.values(compatData)
    .filter((c) => c.enchant_id)
    .map((c) => ({
      id: c.enchant_id,
      name: enchantName(c.enchant_id),
      stat: statMod({ stat: c.mns_stat_id, type: c.mod_type, min: c.conversion, max: c.conversion }),
      itemMin: c.per_item_min,
      itemMax: c.per_item_max,
      min: c.minimum_cap,
      max: c.maximum_cap,
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
const retribution = (effectData as unknown as Record<string, { max_stacks: number; stats: Parameters<typeof statMod>[0][] }>)[RETRIBUTION.effect];

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
  // How many Retribution stacks can be held, and what each gives while it is.
  retribution: { name: text(`mmorpg.effect.${RETRIBUTION.effect}`, RETRIBUTION.effect), max: retribution.max_stacks, stats: retribution.stats.map(statMod) },
  // The skills that are auras, with the effects each keeps up while it is on.
  auras: auraSkills,
  // The effects of skills and of stats that a build can take to be on.
  effects: skillEffects,
};

const sockets = {
  auras,
  rarities: planRarities.filter((r) => !r.runewords),
  jewels: { kinds: jewelKinds, crafted: craftedJewel, eye: abyssalEye, affixes: jewelAffixes },
};

// A perk-style stat: its flat amount only grows with level where it asks to.
const fixedMod = (s: { stat: string; type: string; v1: number; scale_to_lvl?: boolean }): StatMod => {
  const mod = statMod({ stat: s.stat, type: s.type, min: s.v1, max: s.v1 });
  return { ...mod, scaling: s.scale_to_lvl ? mod.scaling : null };
};

interface RawStat {
  ser: string;
  data?: RawStat & { perc: boolean; core_stat_data?: { stats: Parameters<typeof fixedMod>[0][] }; adder_stat: string; add_to: string; priority?: number; per_amount?: number };
  base: number;
  min: number;
  max: number;
  is_perc: boolean;
  is_long?: boolean;
  multiUseType?: string;
  show_in_gui?: boolean;
}
const rawStats = statData as unknown as Record<string, RawStat>;
const statsOf = (ser: string) => Object.entries(rawStats).flatMap(([id, stat]) => (stat.ser === ser ? [[id, stat.data!] as const] : []));

const derived: Derived[] = [
  ...statsOf('one_to_other').map(([id, d]) => ({ id, from: d.adder_stat, to: d.add_to, priority: d.priority! })),
  // AddPerPercentOfOther stats go in the order of their priority, and these after all of them.
  ...statsOf('more_x_per_y').map(([id, d]) => ({ id, from: d.adder_stat, to: d.add_to, per: d.per_amount, priority: 2 ** 31 - 1 })),
];
const coreStats = Object.fromEntries(statsOf('core_stat').map(([id, d]) => [id, d.core_stat_data!.stats.map(fixedMod)]));

// What every character has before anything is put on. The pack plays in ORIGINAL_MODE
// (defaultconfigs/mine_and_slash_compatibility-server.toml): the original base stats, and health
// that counts the vanilla hearts in. Stats the pack makes out of vanilla max health count them too.
const baseMods = [
  ...baseStatData.original_mode_player.base_stats.map(fixedMod),
  fixedMod({ stat: 'health', type: 'FLAT', v1: VANILLA_HEALTH }),
  ...Object.values(compatData)
    .filter((c) => c.attribute_id === 'minecraft:generic.max_health')
    .map((c) => fixedMod({ stat: c.mns_stat_id, type: c.mod_type, v1: Math.min(c.maximum_cap, Math.max(c.minimum_cap, Math.trunc(VANILLA_HEALTH * c.conversion))) })),
];

const stat = (id: string): StatDef => {
  const raw = rawStats[id];
  const { percent, long } = statMod({ stat: id, type: 'FLAT', min: 0, max: 0 });
  const name = text(`mmorpg.stat.${id}`, id);
  if (!raw) return { name, percent, long, ...builtinLimits(id), hidden: false };
  const { base, min, max } = raw.data ?? raw;
  return {
    name,
    percent,
    // AddPerPercentOfOther and MoreXPerYOf print as a sentence.
    long: long || raw.ser === 'one_to_other' || raw.ser === 'more_x_per_y',
    base,
    min,
    max,
    apart: raw.multiUseType === 'MULTIPLICATIVE_DAMAGE',
    hidden: raw.show_in_gui === false,
  };
};

const RESOURCES = ['health', 'magic_shield', 'mana', 'energy', 'blood'];
const ELEMENTS = ['physical', 'fire', 'water', 'lightning', 'chaos', 'elemental'];
const RESISTS = ['fire', 'water', 'lightning', 'chaos'];
const statIds = Object.keys(rawStats);

const partial = { gear, skills, sockets, ...trees };

// Every stat the editor can come across: the pack's own, and the ones built into the mod that
// something in the editor gives or that another stat turns into.
const isMod = (v: object): v is StatMod => 'id' in v && 'percent' in v && 'scaling' in v;
const given = new Set<string>();
const collect = (v: unknown) => {
  if (!v || typeof v !== 'object') return;
  if (isMod(v)) given.add(v.id);
  else Object.values(v).forEach(collect);
};
collect([partial, baseMods, coreStats, defense.mob]);

const rules: StatRules = {
  defs: Object.fromEntries(
    [...new Set([...statIds, ...given, ...Object.values(transfers).flat(), ...derived.flatMap((d) => [d.from, d.to]), ...RESISTS.map((e) => `${e}_resist`), 'spirit_cost'])].map((id) => [id, stat(id)]),
  ),
  transfers,
  core: coreStats,
  derived,
};

const stats = {
  ...rules,
  base: baseMods,
  // The numbers the game's character screen leads with, then its pages (MainHubScreen). Whatever
  // is left goes under the last one.
  main: ['health', 'magic_shield', 'mana', 'energy', 'armor', 'dodge', 'critical_hit', 'critical_damage', ...RESISTS.map((e) => `${e}_resist`)],
  groups: [
    { name: 'Resources and attributes', ids: ['health_regen', 'magic_shield_regen', 'mana_regen', 'energy_regen', 'strength', 'intelligence', 'dexterity'] },
    { name: 'Damage', ids: ['weapon_damage', 'spell_damage', 'str_dmg', 'dex_dmg', 'int_dmg', 'accuracy', 'skill_speed', 'cast_speed', 'attack_cast_speed', 'cdr'] },
    {
      name: 'Elemental damage',
      ids: [...ELEMENTS.map((e) => `all_${e}_damage`), ...ELEMENTS.map((e) => `spell_${e}_damage`), 'armor_penetration', ...RESISTS.slice(0, 3).map((e) => `${e}_penetration`)],
    },
    {
      name: 'Defense',
      ids: ['block_chance', 'max_block_chance', 'block_recovery', 'block_damage_reduction', 'dmg_received', 'dmg_reduction', 'dmg_reduction_chance', ...RESISTS.map((e) => `max_${e}_resist`)],
    },
    {
      name: 'Recovery',
      ids: [
        'increase_healing',
        'heal_effect_on_self',
        'lifesteal',
        'manasteal',
        'spell_lifesteal',
        'spell_mssteal',
        'dot_lifesteal',
        ...statIds.filter((id) => RESOURCES.some((r) => id.startsWith(`${r}_on_hit_`))),
        ...RESOURCES.map((r) => `${r}_on_kill`),
        'inc_leech',
        ...RESOURCES.map((r) => `${r}_leech_cap`),
      ],
    },
  ],
};

export const sections = { ...partial, stats, damage, defense };
export type Sections = typeof sections;

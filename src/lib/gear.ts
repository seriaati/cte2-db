// Build-time only: shapes the extracted game data into what the pages need.
import affixData from '../data/affixes.json';
import baseData from '../data/base_gear_types.json';
import balanceData from '../data/game_balance.json';
import rarityData from '../data/gear_rarity.json';
import iconData from '../data/icons.json';
import slotData from '../data/gear_slot.json';
import langData from '../data/lang.json';
import statData from '../data/stat.json';
import type { Affix, Base, Icon, Rarity, StatMod } from './affix';
import { builtinStat } from './builtinStats';

const lang = langData as Record<string, string>;
const stats = statData as Record<string, any>;
const slots = slotData as Record<string, { fam: string }>;
const icons = iconData as Record<string, Icon>;
const balance = balanceData.original_balance as Record<string, any>;

// Lang strings carry Minecraft colour codes and [text](wiki_link) markup.
const clean = (s: string) => s.replace(/§./g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
export const text = (key: string, fallback: string) => clean(lang[key] ?? fallback);

export function statMod(mod: { stat: string; type: string; min: number; max: number }): StatMod {
  const def = stats[mod.stat];
  const { percent, scaling, long } = def
    ? { percent: def.is_perc ?? def.data.perc, scaling: def.scaling ?? def.data.scale, long: def.is_long ?? false }
    : builtinStat(mod.stat);
  const config = balance[`${scaling}_STAT_SCALING`];
  return {
    id: mod.stat,
    name: text(`mmorpg.stat.${mod.stat}`, mod.stat),
    desc: text(`mmorpg.stat_desc.${mod.stat}`, ''),
    type: mod.type.toUpperCase() as StatMod['type'],
    min: mod.min,
    max: mod.max,
    percent,
    long: long || text(`mmorpg.stat.${mod.stat}`, mod.stat).includes('[VAL1]'),
    scaling: config ? { base: config.base_scaling, perLevel: config.per_level_scaling } : null,
  };
}

export const maxLevel: number = balance.MAX_LEVEL;

export const bases: Base[] = Object.values(baseData).map((b) => ({
  id: b.guid,
  name: text(`mmorpg.gear_type.${b.guid}`, b.guid),
  family: slots[b.gear_slot].fam,
  slot: b.gear_slot,
  icon: icons[b.gear_slot],
  tags: b.tags.tags,
}));

// Minecraft's chat colours, as the game shows them.
const RARITY_COLORS: Record<string, string> = {
  GRAY: '#AAAAAA',
  GREEN: '#55FF55',
  AQUA: '#55FFFF',
  LIGHT_PURPLE: '#FF55FF',
  GOLD: '#FFAA00',
  DARK_PURPLE: '#AA00AA',
};
const RARITY_INKS: Record<string, string> = { DARK_PURPLE: '#D95CD9' };

export const rarities: Rarity[] = Object.values(rarityData)
  .filter((r) => r.type === 'NORMAL')
  .sort((a, b) => a.item_tier - b.item_tier)
  .map((r) => ({
    id: r.guid,
    name: text(`mmorpg.rarity.${r.guid}`, r.guid),
    color: RARITY_COLORS[r.text_format],
    ink: RARITY_INKS[r.text_format] ?? RARITY_COLORS[r.text_format],
    minPercent: r.stat_percents.min,
    maxPercent: r.stat_percents.max,
  }));

const GEAR_AFFIX_TYPES = ['prefix', 'suffix', 'implicit'];

const affixesOf = (types: string[]): Affix[] =>
  Object.values(affixData)
    .filter((a) => types.includes(a.type))
    .map((a) => {
      const req = a.requirements.tag_requirements[0];
      return {
        id: a.guid,
        name: text(`mmorpg.affix.${a.guid}`, a.guid),
        type: a.type as Affix['type'],
        weight: a.weight,
        requireAll: req.req_type === 'HAS_ALL',
        included: req.included,
        excluded: req.excluded,
        stats: a.stats.map(statMod),
      };
    });

export const affixes = affixesOf(GEAR_AFFIX_TYPES);
// The data files call infusions "enchant" affixes. A weight of 0 never wins the game's weighted
// roll, so those can't end up on an item.
export const infusions = affixesOf(['enchant']).filter((a) => a.weight > 0);

// Affix requirements also list tags no base carries (might, finesse, ingenuity); those are left out.
const baseTags = new Set(bases.flatMap((b) => b.tags));
export const tagNames: Record<string, string> = Object.fromEntries(
  [...baseTags].map((tag) => [tag, text(`mmorpg.tag.gear_slot.${tag}`, tag)]),
);

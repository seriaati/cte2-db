// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import gemData from '../data/gems.json';
import type { Rarity } from './affix';
import { maxLevel, rarities, text } from './gear';
import { familyStats, floatInt, sprite, type FamilyStats } from './items';

export interface Gem {
  id: string;
  name: string;
  icon: string;
  tier: number;
  stats: FamilyStats;
  dropLevel: number;
  // GemLootGen in Mine and Slash picks gems by weight, so a weight of 0 never drops as loot.
  drops: boolean;
}

export interface GemRank {
  tier: number;
  name: string;
  rarity: Rarity;
}

// GemItem.GemRank in Mine and Slash 6.4.13, in tier order. The data files only carry the tier.
const RANKS = ['cracked', 'chipped', 'flawed', 'regular', 'grand', 'glorious', 'divine', 'pinnacle'];

const all = Object.values(gemData).sort((a, b) => a.gem_type.localeCompare(b.gem_type));

export const ranks: GemRank[] = RANKS.map((rank, tier) => ({
  tier,
  name: text(`mmorpg.gem_rank.${rank}`, rank),
  rarity: rarities.find((r) => r.id === all.find((g) => g.tier === tier)!.rar)!,
}));

// Gem stats are a single value: no roll, and none of them scales with level.
const fixed = (s: { stat: string; type: string; v1: number }) => ({ stat: s.stat, type: s.type, min: s.v1, max: s.v1 });

export const gems: Gem[] = all.map((g) => ({
  id: g.identifier,
  name: text('mmorpg.formatter.gem_item_name', '')
    .replace('%1$s', ranks[g.tier].name)
    .replace('%2$s', text(`mmorpg.gem_type.${g.gem_type}`, g.gem_type)),
  icon: sprite(g.item_id),
  tier: g.tier,
  stats: familyStats({
    on_weapons_stats: g.on_weapons_stats.map(fixed),
    on_armor_stats: g.on_armor_stats.map(fixed),
    on_jewelry_stats: g.on_jewelry_stats.map(fixed),
  }),
  dropLevel: floatInt(maxLevel, g.min_lvl_multi),
  drops: g.weight > 0,
}));

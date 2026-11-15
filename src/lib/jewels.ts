// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import affixData from '../data/affixes.json';
import rarityData from '../data/gear_rarity.json';
import type { StatMod } from './affix';
import { statMod, text } from './gear';
import { sprite } from './items';

export interface JewelItem {
  name: string;
  icon: string;
}

export interface JewelKind extends JewelItem {
  id: string;
  // The affix tag for this kind; affixes tagged any_jewel fit every kind.
  tag: string;
}

export interface JewelAffix {
  id: string;
  weight: number;
  tags: string[];
  stats: StatMod[];
  // Abyssal Eye affixes only: the augment that has to be on for the stats to count.
  aura: string;
}

const item = (id: string): JewelItem => ({ name: text(`item.mmorpg.jewel.${id}`, id), icon: sprite(`mmorpg:jewel/${id}`) });

export const jewelKinds: JewelKind[] = ['str', 'dex', 'int'].map((id) => ({ id, tag: `jewel_${id}`, ...item(id) }));
export const craftedJewel = item('unique_crafted');
export const abyssalEye = item('watcher_eye');

// Jewel affixes have no names in game, so each list is ordered by what it gives.
const pool = (type: string): JewelAffix[] =>
  Object.values(affixData)
    .filter((a) => a.type === type)
    .map((a) => ({
      id: a.guid,
      weight: a.weight,
      tags: a.requirements.tag_requirements[0].included,
      stats: a.stats.map(statMod),
      aura: a.eye_aura_req && text(`mmorpg.aura.${a.eye_aura_req}`, a.eye_aura_req),
    }))
    .sort((a, b) => (a.aura || a.stats[0].name).localeCompare(b.aura || b.stats[0].name));

export const jewelAffixes = {
  jewel: pool('jewel'),
  corruption: pool('jewel_corruption'),
  crafted: pool('crafted_jewel_unique'),
  eye: pool('watcher_eye'),
};

// JewelItemData.generateAffixes in Mine and Slash: one affix, plus one for every two the rarity gives gear.
export const affixCounts: Record<string, number> = Object.fromEntries(
  Object.values(rarityData).map((r) => [r.guid, 1 + Math.floor(r.min_affixes / 2)]),
);

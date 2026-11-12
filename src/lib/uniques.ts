// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import rarityData from '../data/gear_rarity.json';
import uniqueData from '../data/unique_gears.json';
import type { Rarity, StatMod } from './affix';
import { statMod, text } from './gear';

export interface Unique {
  id: string;
  name: string;
  base: string;
  stats: StatMod[];
  minLevel: number;
  minMapTier: number;
  // A league id, 'any' for ordinary loot, or 'none' for uniques that never drop.
  source: string;
}

export interface Source {
  id: string;
  name: string;
}

// hide_from_wiki marks uniques the pack has disabled (all weight 0); the in-game wiki and Unique
// Collection skip them too. "empty" is the mod's placeholder for an invalid unique id.
const shown = Object.values(uniqueData).filter((u) => !('hide_from_wiki' in u) && u.guid !== 'empty');

// UniqueGearPart.eligibleUniques in Mine and Slash only rolls uniques with a weight above 0.
const source = (u: { weight: number; league: string }) => (u.weight ? u.league || 'any' : 'none');

export const uniques: Unique[] = shown.map((u) => ({
  id: u.guid,
  name: text(`mmorpg.unique_gear.${u.guid}.name`, u.guid),
  base: u.base_gear,
  stats: u.unique_stats.map(statMod),
  minLevel: u.min_drop_lvl,
  minMapTier: u.min_tier,
  source: source(u),
}));

// These two leagues are named in their own mods' lang files, which the extractor doesn't read.
const LEAGUE_NAMES: Record<string, string> = { harvest: 'The Harvest', obelisk: 'Ancient Obelisks' };

const leagues = [...new Set(shown.map((u) => u.league).filter(Boolean))].sort();

export const sources: Source[] = [
  { id: 'any', name: 'Any loot' },
  ...leagues.map((id) => ({ id, name: text(`library_of_exile.league.${id}`, LEAGUE_NAMES[id]) })),
  { id: 'none', name: 'Not a drop' },
];

const UNIQUE_COLORS: Record<string, string> = { RED: '#FF5555' };

const rarity = rarityData.unique;

export const uniqueRarity: Rarity = {
  id: rarity.guid,
  name: text(`mmorpg.rarity.${rarity.guid}`, rarity.guid),
  color: UNIQUE_COLORS[rarity.text_format],
  ink: UNIQUE_COLORS[rarity.text_format],
  minPercent: rarity.stat_percents.min,
  maxPercent: rarity.stat_percents.max,
};

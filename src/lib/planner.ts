// Build-time only: the extra gear data the planner needs on top of gear.ts.
import affixData from '../data/affixes.json';
import baseData from '../data/base_gear_types.json';
import rarityData from '../data/gear_rarity.json';
import { affixes, bases, rarities, statMod } from './gear';
import { runed } from './runes';
import type { Rarity } from './affix';
import type { PlanAffix, PlanBase, PlanRarity } from './plannerRules';

const rawAffixes = affixData as Record<string, { only_one_per_item: boolean }>;
const rawBases = baseData as Record<string, { base_stats: Parameters<typeof statMod>[0][] }>;
const rawRarities = rarityData as Record<
  string,
  {
    min_affixes: number;
    base_stat_percents: { min: number; max: number };
    sockets: { max: number };
    max_gems: number;
    max_runes: number;
    can_have_runewords: boolean;
  }
>;

export const planBases: PlanBase[] = bases.map((b) => ({ ...b, stats: rawBases[b.id].base_stats.map(statMod) }));

export function planRarity(r: Rarity): PlanRarity {
  const raw = rawRarities[r.id];
  return {
    ...r,
    affixCount: raw.min_affixes,
    baseMinPercent: raw.base_stat_percents.min,
    baseMaxPercent: raw.base_stat_percents.max,
    sockets: raw.sockets.max,
    maxGems: raw.max_gems,
    maxRunes: raw.max_runes,
    runewords: raw.can_have_runewords,
  };
}

// Runed gear is planned like any other rarity: it has no affix slots, but more sockets and runewords.
export const planRarities: PlanRarity[] = [...rarities, runed].map(planRarity);

// A weight of 0 never wins the game's weighted roll, so those can't end up on a drop.
export const planAffixes: PlanAffix[] = affixes
  .filter((a) => a.weight > 0)
  .map((a) => ({ ...a, repeatable: !rawAffixes[a.id].only_one_per_item }));

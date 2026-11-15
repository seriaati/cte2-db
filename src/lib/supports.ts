// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import balanceData from '../data/game_balance.json';
import supportData from '../data/support_gem.json';
import type { StatMod } from './affix';
import { statMod, text } from './gear';
import { floatInt, sprite } from './items';

export interface Support {
  id: string;
  name: string;
  icon: string;
  style: string;
  stats: StatMod[];
  // The player level needed to use it, and the monster level it starts dropping at.
  minLevel: number;
  // What it multiplies the skill's resource cost by, as a percentage.
  cost: number;
  // A skill can hold only one support of the same kind; empty for most.
  oneKind: string;
}

// SkillGemBlueprint in Mine and Slash picks the gem by weight, so a weight of 0 never drops.
export const supports: Support[] = Object.values(supportData)
  .filter((g) => g.weight > 0)
  .map((g) => ({
    id: g.id,
    name: text(`mmorpg.support_gem.${g.id}`, g.id),
    // SkillGemsItems: the style only picks which of the three gem items the support is.
    icon: sprite(`mmorpg:skill_gems/support/${g.style.toLowerCase()}`),
    style: g.style,
    stats: g.stats.map(statMod),
    minLevel: g.min_lvl,
    cost: floatInt(g.manaMulti, 100),
    // The game's tooltip prints the bare id.
    oneKind: g.one_of_a_kind.replaceAll('_', ' '),
  }))
  .sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));

// GameBalanceConfig.getMaxLinksForLevel: the player levels that unlock a skill's first to fifth support slot.
const balance = balanceData.original_balance;
export const slotLevels = [balance.link_1_lvl, balance.link_2_lvl, balance.link_3_lvl, balance.link_4_lvl, balance.link_5_lvl];

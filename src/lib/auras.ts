// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import auraData from '../data/aura.json';
import type { StatMod } from './affix';
import { statMod, text } from './gear';
import { floatInt, sprite } from './items';

export interface Aura {
  id: string;
  name: string;
  icon: string;
  style: string;
  stats: StatMod[];
  // The player level needed to equip it, and the monster level it starts dropping at.
  minLevel: number;
  // Points of Augment Capacity it takes up while equipped.
  reserves: number;
}

export const auras: Aura[] = Object.values(auraData)
  .map((a) => ({
    id: a.id,
    name: text(`mmorpg.aura.${a.id}`, a.id),
    // SkillGemsItems in Mine and Slash: the style only picks which of the three gem items the aura is.
    icon: sprite(`mmorpg:skill_gems/aura/${a.style.toLowerCase()}`),
    style: a.style,
    stats: a.stats.map(statMod),
    minLevel: a.min_lvl,
    reserves: floatInt(a.reservation, 100),
  }))
  .sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));

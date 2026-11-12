// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import rarityData from '../data/gear_rarity.json';
import slotData from '../data/gear_slot.json';
import runeData from '../data/runes.json';
import runewordData from '../data/runeword.json';
import uniqueData from '../data/unique_gears.json';
import type { Rarity, StatMod } from './affix';
import { maxLevel, statMod, text } from './gear';
import { familyStats, floatInt, sprite, type FamilyStats } from './items';

export interface Rune {
  id: string;
  name: string;
  icon: string;
  stats: FamilyStats;
  // The lowest monster level it drops at.
  dropLevel: number;
  // RunePart in Mine and Slash picks runes by weight, so a weight of 0 never drops as loot.
  drops: boolean;
}

export interface Runeword {
  id: string;
  name: string;
  // In the order they have to be socketed.
  runes: string[];
  slots: string[];
  family: string;
  stats: StatMod[];
}

const slots = slotData as Record<string, { fam: string }>;

export const runes: Rune[] = Object.values(runeData).map((r) => ({
  id: r.id,
  name: text(`item.${r.item_id.replace(':', '.').replace('/', '.')}`, r.id),
  icon: sprite(r.item_id),
  stats: familyStats(r),
  // RuneLootGen only rolls for monsters above level 10.
  dropLevel: Math.max(floatInt(maxLevel, r.min_lvl_multi), 11),
  drops: r.weight > 0,
}));

// "empty" is the mod's placeholder for gear without a runeword.
export const runewords: Runeword[] = Object.values(runewordData)
  .filter((w) => w.id !== 'empty')
  .map((w) => ({
    id: w.id,
    name: text(`mmorpg.runeword.${w.id}`, w.id),
    runes: w.runes,
    slots: w.slots,
    family: slots[w.slots[0]].fam,
    stats: w.stats.map(statMod),
  }));

export const slotNames: Record<string, string> = Object.fromEntries(
  Object.keys(slots).map((slot) => [slot, text(`mmorpg.gearslot.${slot}`, slot)]),
);

const RUNED_COLORS: Record<string, string> = { YELLOW: '#FFFF55' };

const rarity = rarityData.runeword;

// A rune and a runeword each roll anywhere in their range, whatever the gear's rarity
// (RuneItem and GearSocketsData.setRuneword in Mine and Slash).
export const runed: Rarity = {
  id: rarity.guid,
  name: text(`mmorpg.rarity.${rarity.guid}`, rarity.guid),
  color: RUNED_COLORS[rarity.text_format],
  ink: RUNED_COLORS[rarity.text_format],
  minPercent: 0,
  maxPercent: 100,
};

export const runedSockets = rarity.sockets;

// A unique only takes runes if its data says so.
export const uniquesTakeRunes = Object.values(uniqueData).some((u) => u.runable);

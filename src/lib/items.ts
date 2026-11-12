// Build-time only: helpers shared by the rune, gem and aura data.
import type { StatMod } from './affix';
import { statMod } from './gear';

// The game multiplies these as 32-bit floats and drops the fraction.
export const floatInt = (a: number, b: number) => Math.trunc(Math.fround(Math.fround(a) * Math.fround(b)));

// scripts/extract.ts copies each item's sprite to public/items/<item path>.png.
export const sprite = (item: string) => `/items/${item.split(':')[1]}.png`;

// What a rune or gem gives depends on the gear it sits in. Off-hand gear uses the armor stats
// (Rune.getFor and BaseGem.getFor in Mine and Slash fall back to them).
export type FamilyStats = Record<'Weapon' | 'Armor' | 'Jewelry', StatMod[]>;

type RawMod = Parameters<typeof statMod>[0];

export const familyStats = (item: { on_weapons_stats: RawMod[]; on_armor_stats: RawMod[]; on_jewelry_stats: RawMod[] }): FamilyStats => ({
  Weapon: item.on_weapons_stats.map(statMod),
  Armor: item.on_armor_stats.map(statMod),
  Jewelry: item.on_jewelry_stats.map(statMod),
});

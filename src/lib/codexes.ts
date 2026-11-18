// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import rarityData from '../data/gear_rarity.json';
import type { Rarity } from './affix';
import { codexPercent, RARITY_TYPES, type Codex, type RarityType } from './buildRules';
import { sections } from './builds';

type Range = { min: number; max: number };
const raw = rarityData as unknown as Record<string, { omens: Record<RarityType | 'affixes' | 'specific_slots', Range> & { stat_multi: number } }>;
const { codex, rarities } = sections.gear;

export interface CodexRarity extends Rarity {
  // How many worn pieces of each kind a codex of this rarity can ask for.
  pieces: Record<RarityType, Range>;
  affixes: Range;
  slots: Range;
  multi: number;
  // Where its stats and affixes roll in their ranges, from a codex asking for the fewest to one asking for the most.
  percent: Range;
}

// OmenData: a codex rolls within its rarity's limits, and the more it asks for the higher its stats.
export const codexRarities: CodexRarity[] = rarities
  .filter((r) => !r.runewords)
  .map((r) => {
    const o = raw[r.id].omens;
    const percent = (end: keyof Range) =>
      codexPercent({ pieces: Object.fromEntries(RARITY_TYPES.map((type) => [type, o[type][end]])), slots: Array.from({ length: o.specific_slots[end] }) } as Codex, o.stat_multi);
    return {
      ...r,
      pieces: Object.fromEntries(RARITY_TYPES.map((type) => [type, o[type]])) as Record<RarityType, Range>,
      affixes: o.affixes,
      slots: o.specific_slots,
      multi: o.stat_multi,
      percent: { min: percent('min'), max: percent('max') },
    };
  });

export const AFFIX_TYPES: Record<string, string> = { chaos_stat: 'Corruption affixes', jewel_corruption: 'Jewel corruption affixes' };

export const codexIcon = codex.icon;
export const codexKinds = codex.kinds;
// Only the kinds of affix some codex rolls; in this pack that is corruption alone.
export const codexAffixes = codex.affixes.filter((a) => codexKinds.some((k) => k.affixTypes.includes(a.type))).map(({ id, type, stats }) => ({ id, type, stats }));
export type CodexKind = (typeof codexKinds)[number];
export type CodexAffix = (typeof codexAffixes)[number];

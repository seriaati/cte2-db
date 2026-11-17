// Build-time only: what the defense tab needs to know about stats and mobs. Components take the
// types from defenseRules.ts.
import baseStatData from '../data/base_stats.json';
import balanceData from '../data/game_balance.json';
import affixData from '../data/mob_affix.json';
import rarityData from '../data/mob_rarity.json';
import { transfers } from './builtinStats';
import { damage, statRules } from './damage';
import type { DefenseRules } from './defenseRules';
import { statMod, text } from './gear';

const balance = balanceData.original_balance;
const { rules: taken, situational } = statRules('Target');

// Stats that change the hit a mob deals: its accuracy, and the ones with an effect on a hit.
const counts = ({ id }: { id: string }): boolean => id === 'accuracy' || id in damage.rules || !!transfers[id]?.some((to) => counts({ id: to }));

const mob: DefenseRules['mob'] = {
  // The pack's base stats for mobs, and the accuracy MobStatUtils.getMobBaseStats gives each.
  stats: [
    ...baseStatData.mob.base_stats.map((s) => {
      const mod = statMod({ stat: s.stat, type: s.type, min: s.v1, max: s.v1 });
      return { ...mod, scaling: s.scale_to_lvl ? mod.scaling : null };
    }),
    statMod({ stat: 'accuracy', type: 'FLAT', min: 1, max: 1 }),
  ].filter(counts),
  power: { base: balance.MOB_DMG_POWER_SCALING_BASE, growth: balance.MOB_DMG_POWER_SCALING },
  // The summon rarity is for what players summon.
  rarities: Object.values(rarityData)
    .filter((r) => r.id !== 'summon')
    .sort((a, b) => a.dmg_multi - b.dmg_multi)
    .map((r) => ({ id: r.id, name: r.name, damage: r.dmg_multi, affixes: r.affixes })),
  // The affixes a mob can roll that change its hits.
  affixes: Object.values(affixData)
    .filter((a) => a.weight > 0)
    .map((a) => ({ id: a.id, name: text(`mmorpg.mob_affix.${a.id}`, a.id), stats: a.stats.map(statMod).filter(counts) }))
    .filter((a) => a.stats.length)
    .sort((a, b) => a.name.localeCompare(b.name)),
};

const given = [...mob.stats, ...mob.affixes.flatMap((a) => a.stats)].flatMap((mod) => [mod.id, ...(transfers[mod.id] ?? [])]);

export const defense: DefenseRules = {
  rules: Object.fromEntries([...new Set(given)].filter((id) => id in damage.rules).map((id) => [id, damage.rules[id]])),
  taken,
  layers: damage.layers,
  scaling: damage.scaling,
  takenAs: damage.takenAs,
  situational: [...situational].sort(),
  mob,
};

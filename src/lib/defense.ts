// Build-time only: what the defense tab needs to know about stats and mobs. Components take the
// types from defenseRules.ts.
import baseStatData from '../data/base_stats.json';
import balanceData from '../data/game_balance.json';
import affixData from '../data/mob_affix.json';
import rarityData from '../data/mob_rarity.json';
import { RESISTS } from './buildRules';
import { transfers } from './builtinStats';
import { damage, skillEffects, statRules } from './damage';
import type { DefenseRules } from './defenseRules';
import { statMod, text } from './gear';

const balance = balanceData.original_balance;
const { rules: taken, situational, healing } = statRules('Target');

const resists = RESISTS.map((element) => `${element}_resist`);
// Stats that change the hit a mob deals or what it takes of one: its accuracy, its defenses, and
// the ones with an effect on a hit.
const counts = ({ id }: { id: string }): boolean =>
  ['accuracy', 'armor', 'dodge', 'spell_dodge', ...resists].includes(id) || id in damage.rules || !!transfers[id]?.some((to) => counts({ id: to }));
// MobStatUtils.getMobBaseStats (6.4.13): a mob's armor before it is scaled to its level, and its
// resistance to each element, for each 1 of its rarity's stat multiplier.
const PER_STAT_MULTI = 10;

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
    .map((r) => ({
      id: r.id,
      name: r.name,
      damage: r.dmg_multi,
      affixes: r.affixes,
      stats: [...['armor', ...resists].map((stat) => ({ stat, type: 'FLAT', min: PER_STAT_MULTI * r.stat_multi, max: PER_STAT_MULTI * r.stat_multi })), ...r.stats].map(statMod),
    })),
  // The affixes a mob can roll that change its hits or its defenses.
  affixes: Object.values(affixData)
    .filter((a) => a.weight > 0)
    .map((a) => ({ id: a.id, name: text(`mmorpg.mob_affix.${a.id}`, a.id), stats: a.stats.map(statMod).filter(counts) }))
    .filter((a) => a.stats.length)
    .sort((a, b) => a.name.localeCompare(b.name)),
};

// What a mob can have: its own stats, and those of the effects a build puts on it.
const given = [...mob.stats, ...mob.affixes.flatMap((a) => a.stats), ...skillEffects.filter((e) => e.enemy).flatMap((e) => e.stats)].flatMap((mod) => [mod.id, ...(transfers[mod.id] ?? [])]);

export const defense: DefenseRules = {
  rules: Object.fromEntries([...new Set(given)].filter((id) => id in damage.rules).map((id) => [id, damage.rules[id]])),
  taken,
  layers: damage.layers,
  scaling: damage.scaling,
  takenAs: damage.takenAs,
  // Those whose effect on what is restored depends on the moment are left out of recovery.
  situational: [...new Set([...situational, ...healing, ...statRules('Source').healing])].sort(),
  mob,
};

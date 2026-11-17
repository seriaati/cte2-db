import { useMemo } from 'react';
import { rolled } from '../../lib/affix';
import { GEAR_SLOTS, OFFHAND_WEAPON_PERCENT, SOLO_CLASS, TREES, codexBonuses, exactly, type Build } from '../../lib/buildRules';
import type { Sections } from '../../lib/builds';
import { MODIFIES, baseRange, type Part } from '../../lib/plannerRules';
import { newbieResists, totalStats, type Exact, type Source, type Total } from '../../lib/statRules';
import { readCodex } from './CodexEditor';
import { itemParts, nameOf, readItem } from './ItemEditor';
import { jewelParts } from './JewelsTab';
import { useSection } from './shared';
import { connected } from './TalentsTab';

export interface Totals {
  rules: Sections['stats'];
  stats: Map<string, Total>;
  // Why parts of the build give nothing.
  skipped: string[];
  // The base of the weapon held, and whether a second one is held beside it.
  weapon?: string;
  dualWield: boolean;
  // Whether what is held in the off hand is a shield.
  shield: boolean;
}

const exact = ({ stats, rolls, level }: Part): Exact[] => stats.map((s) => ({ id: s.id, type: s.type, value: rolled(s, rolls.maxPercent, level) }));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Everything that gives a character stats, as the game gathers it (StatCalculation.collectStatsWithCtx
// and CachedPlayerStats). What it takes from a weapon in the off hand depends on a stat of the
// character's own, so that is passed in. `extra` is what a skill adds for itself alone.
function gather(data: Sections, build: Build, dualWield: number, extra: Exact[]) {
  const { level } = build;
  const skipped: string[] = [];
  const others: Exact[] = [...extra, ...exact({ stats: data.stats.base, rolls: exactly(100), level }), ...newbieResists(level)];

  // GearData: gear above the character's level gives nothing, and a weapon in the off hand gives
  // a share of its stats when it is one that can be dual wielded beside a one-handed weapon.
  const mainHand = build.gear.weapon && readItem(data.gear, build.gear.weapon)?.base;
  const worn = GEAR_SLOTS.flatMap((slot) => {
    const item = build.gear[slot.id];
    const parts = item && readItem(data.gear, item);
    if (!parts) return [];
    if (item.level > level) {
      skipped.push(`${nameOf(parts)} is level ${item.level}, above the character's level.`);
      return [];
    }
    const second = slot.id === 'offhand' && parts.base.family === 'Weapon';
    if (second && !(parts.base.dualWield && mainHand?.dualWield !== false)) {
      skipped.push(`${nameOf(parts)} gives nothing in the off hand: ${parts.base.dualWield ? `a ${mainHand!.name.toLowerCase()}` : 'it'} can't be dual wielded.`);
      return [];
    }
    return [{ item, parts, share: second ? (OFFHAND_WEAPON_PERCENT / 100) * Math.max(0, 1 + dualWield / 100) : 1 }];
  });
  for (const { item, parts, share } of worn) {
    const { base, others: rest } = itemParts(parts, item);
    // Gear's Defense and Gear's Weapon Damage are already in the base stats.
    const stats = [...base.stats.map((s): Exact => ({ id: s.id, type: s.type, value: baseRange(s, base, rest)[1] })), ...rest.flatMap(exact).filter((mod) => !(mod.id in MODIFIES))];
    others.push(...stats.map((mod) => ({ ...mod, value: mod.value * share })));
  }

  // GearItemData.getEnchantCompatStats: an enchantment counts on every piece, up to a cap for each and one for all.
  for (const enchant of data.gear.enchants) {
    const sum = worn.reduce((total, { item }) => {
      const held = item.enchants.find((e) => e.id === enchant.id);
      return held ? total + clamp(Math.trunc(held.level * enchant.stat.min), enchant.itemMin, enchant.itemMax) : total;
    }, 0);
    if (sum) others.push({ id: enchant.stat.id, type: enchant.stat.type, value: clamp(sum, enchant.min, enchant.max) });
  }

  // EquippedSets: a set counts each of its uniques once, and its bonuses are worked out at the pieces' average level.
  for (const set of data.gear.sets) {
    const pieces = worn.filter((w, i) => w.parts.unique && set.uniques.includes(w.parts.unique.id) && worn.findIndex((o) => o.parts.unique === w.parts.unique) === i);
    const average = Math.trunc(pieces.reduce((sum, w) => sum + w.item.level, 0) / pieces.length);
    for (const bonus of set.bonuses) if (pieces.length >= bonus.pieces) others.push(...exact({ stats: bonus.stats, rolls: exactly(100), level: average }));
  }

  const codex = readCodex(data.gear, build);
  if (codex) {
    for (const bonus of codexBonuses(codex.codex, codex.kind.mods, codex.affixes)) {
      if (codex.worn >= bonus.pieces) others.push(...exact({ stats: [...(bonus.mods ?? []), ...(bonus.affix?.stats ?? [])], rolls: exactly(codex.percent), level: codex.codex.level }));
    }
  }

  for (const [id, points] of Object.entries(build.stats)) if (id in data.stats.core) others.push({ id, type: 'FLAT', value: points });

  for (const id of TREES) {
    const tree = data[id];
    for (const node of connected(tree, build.trees[id])) others.push(...exact({ stats: tree.perks[tree.nodes[node][2]].stats, rolls: exactly(100), level }));
  }

  // SpellSchoolsData: every level of a passive gives as much again, and a character with points
  // in one class alone gets a bonus.
  const classes = data.skills.classes.filter((c) => build.classes.includes(c.id)).map((c) => c.perks.filter((perk) => build.perks[perk.id] > 0));
  for (const perk of classes.flat()) {
    if (!perk.spell) others.push(...perk.stats.map((s): Exact => ({ id: s.id, type: s.type, value: rolled(s, 100, level) * build.perks[perk.id] })));
  }
  if (classes.filter((perks) => perks.length).length === 1) {
    others.push({ id: 'total_damage', type: 'MORE', value: SOLO_CLASS.moreDamage }, { id: 'dmg_reduction', type: 'FLAT', value: SOLO_CLASS.damageReduction });
  }

  const auras = build.augments.flatMap((a) => {
    const aura = data.sockets.auras.find((x) => x.id === a.id);
    return aura ? [{ id: aura.id, stats: exact({ stats: aura.stats, rolls: exactly(a.roll ?? 100), level }) }] : [];
  });

  // JewelItemData: a jewel above the character's level can't be worn, and an Abyssal Eye's affix
  // counts while its augment is on.
  const jewels = build.jewels.flatMap((jewel) => {
    const about = data.sockets.jewels;
    if (jewel.level > level) {
      const name = jewel.kind === 'crafted' ? about.crafted.name : jewel.kind === 'eye' ? about.eye.name : about.kinds.find((k) => k.id === jewel.kind)!.name;
      skipped.push(`${name} is level ${jewel.level}, above the character's level.`);
      return [];
    }
    return jewelParts(data.sockets, jewel).flatMap(({ part, auraId }) => (!auraId || auras.some((a) => a.id === auraId) ? exact(part) : []));
  });

  const sources: Source[] = [{ kind: 'other', stats: others }, { kind: 'jewel', stats: jewels }, ...auras.map(({ stats }): Source => ({ kind: 'aura', stats }))];
  return {
    sources,
    skipped,
    secondWeapon: worn.some((w) => w.share !== 1),
    weapon: worn.find((w) => w.item === build.gear.weapon)?.parts.base.id,
    shield: worn.some((w) => w.item === build.gear.offhand && w.parts.base.slot === 'shield'),
  };
}

const NONE: Exact[] = [];

// What the whole build's stats come to, with what a skill adds for itself when that is given. Null
// until all the game data it draws on has arrived.
export function useTotals(build: Build, extra = NONE): Totals | null {
  const data = {
    stats: useSection('stats'),
    gear: useSection('gear'),
    skills: useSection('skills'),
    sockets: useSection('sockets'),
    talents: useSection('talents'),
    ascendancy: useSection('ascendancy'),
    atlas: useSection('atlas'),
  };
  return useMemo(() => {
    if (Object.values(data).some((section) => !section)) return null;
    const loaded = data as Sections;
    // CachedEntityStats.afterStatCalc: the gear is gone over again until Dual Wield Effectiveness settles.
    let dualWield = 0;
    for (let pass = 0; ; pass++) {
      const { sources, skipped, secondWeapon, weapon, shield } = gather(loaded, build, dualWield, extra);
      const stats = totalStats(loaded.stats, sources);
      const next = stats.get('dual_wield_effectiveness')?.value ?? 0;
      if (!secondWeapon || Math.abs(next - dualWield) <= 0.01 || pass === 5) return { rules: loaded.stats, stats, skipped, weapon, dualWield: secondWeapon, shield };
      dualWield = next;
    }
  }, [build, extra, ...Object.values(data)]);
}

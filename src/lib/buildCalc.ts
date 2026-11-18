// Client-safe: what a build comes to, worked out from the game data the editor fetches: the parts
// of it the pack still knows, its stats, and what it deals and takes. Like affix.ts, no data imports here.
import { canRoll, formatRange, rolled, type StatMod } from './affix';
import {
  GEAR_SLOTS,
  MAX_JEWELS,
  OFFHAND_WEAPON_PERCENT,
  RETRIBUTION,
  SOLO_CLASS,
  TARGETS,
  TREES,
  codexBonuses,
  codexPercent,
  exactly,
  jewelAffixes,
  needsAt,
  rollIn,
  type Build,
  type Codex,
  type GearSlot,
  type Item,
  type Jewel,
  type Rolled,
} from './buildRules';
import type { Core, Sections } from './builds';
import {
  ELEMENTS,
  UNARMED,
  addTo,
  armorShare,
  attackCost,
  attackDamage,
  attackRate,
  effectDamage,
  formOf,
  procDamage,
  regenerated,
  resistance,
  skillDamage,
  sustain,
  useCost,
  type ByElement,
  type ByResource,
  type Damage,
  type Element,
  type Fighter,
  type Gift,
  type SkillHit,
  type Used,
} from './damageRules';
import { avoidance, mobStats, taken, type Enemy } from './defenseRules';
import { MODIFIES, baseRange, formedRuneword, itemName, rollWindows, slotCount, socketPart, type Part, type Socketed } from './plannerRules';
import { leveled, type Spell } from './spellRules';
import { bonusSkillLevels, newbieResists, totalStats, type Exact, type Source, type StatDef, type Total } from './statRules';
import { neighbours, rooted } from './talentRules';
import type { TalentTree } from './talents';

type Gear = Sections['gear'];
// The game data a build's stats are worked out from.
export type Data = Omit<Sections, 'damage'>;

// The parts of an item that game data still knows, with what each gives at its roll.
export function readItem(data: Gear, item: Item) {
  const base = data.bases.find((b) => b.id === item.base);
  if (!base) return null;
  const unique = data.uniques.find((u) => u.id === item.unique && u.base === base.id);
  const tiers = data.rarities.filter((r) => !r.runewords);
  const rarity = unique ? data.uniqueRarity : (data.rarities.find((r) => r.id === item.rarity) ?? tiers.at(-1)!);
  const rollable = data.affixes.filter((a) => canRoll(a, base));
  const implicits = rollable.filter((a) => a.type === 'implicit');
  const affixes = (type: 'prefix' | 'suffix') =>
    item[type].flatMap((placed) => rollable.find((a) => a.id === placed.id && a.type === type) ?? []).slice(0, slotCount(rarity, type));
  const kind = data.corruption.kinds.find((k) => k.id === item.corruption?.kind && k.rarities.includes(rarity.id));
  const kept = { gem: 0, rune: 0 };
  const sockets = item.sockets
    .flatMap((s): (Socketed & { roll?: number })[] => {
      const found = s.kind === 'gem' ? data.gems.find((g) => g.id === s.id) : data.runes.find((r) => r.id === s.id);
      return found ? [{ kind: s.kind, item: found, roll: s.roll } as Socketed & { roll?: number }] : [];
    })
    .slice(0, rarity.sockets + (kind?.sockets ?? 0))
    .filter((s) => kept[s.kind]++ < (s.kind === 'gem' ? rarity.maxGems : rarity.maxRunes));
  const runes = sockets.filter((s) => s.kind === 'rune').map((s) => s.item.id);
  const infusion = data.infusions.find((a) => a.id === item.infusion?.id && canRoll(a, base));
  return {
    base,
    unique,
    rarity,
    tiers,
    rollable,
    implicits,
    // A drop always has an implicit when its base has any, uniques included (GearCreationUtils).
    implicit: implicits.find((a) => a.id === item.implicit?.id) ?? implicits[0],
    prefix: affixes('prefix'),
    suffix: affixes('suffix'),
    kind,
    corrupted: kind ? item.corruption!.affixes.flatMap((placed) => data.corruption.affixes.find((a) => a.id === placed.id && canRoll(a, base)) ?? []).slice(0, kind.affixes) : [],
    sockets,
    socketCount: rarity.sockets + (kind?.sockets ?? 0),
    runeword: rarity.runewords ? formedRuneword(data.runewords, runes, base.slot) : undefined,
    infusion,
    infusionRarity: tiers.find((r) => r.id === item.infusion?.rarity) ?? tiers.at(-1)!,
    enchants: item.enchants.flatMap((e) => {
      const enchant = data.enchants.find((x) => x.id === e.id);
      return enchant ? [{ ...enchant, level: e.level }] : [];
    }),
  };
}

export const nameOf = (parts: NonNullable<ReturnType<typeof readItem>>) =>
  parts.unique?.name ?? itemName(parts.base, parts.implicit, parts.prefix[0], parts.suffix[0]);

const whole = { minPercent: 0, maxPercent: 100 };

// What the item gives at its rolls: the base stats, and every other part, which can change them.
export function itemParts(parts: NonNullable<ReturnType<typeof readItem>>, item: Item): { base: Part; others: Part[] } {
  const { base, unique, rarity, implicit, runeword, infusion, infusionRarity } = parts;
  const { level } = item;
  // An affix can be of any tier up to the item's rarity, so it rolls anywhere below that rarity's best.
  const affixWindow = { minPercent: 0, maxPercent: rarity.maxPercent };
  const at = (stats: StatMod[], percent: number): Part => ({ stats, rolls: exactly(percent), level });
  return {
    base: at(base.stats, rollIn(item.baseRoll, rollWindows(rarity).base)),
    others: [
      ...(unique ? unique.stats.map((stat, i) => at([stat], item.uniqueRolls?.[i] ?? 100)) : []),
      ...(implicit ? [at(implicit.stats, rollIn(item.implicit?.roll, whole))] : []),
      ...(['prefix', 'suffix'] as const).flatMap((type) => parts[type].map((a, i) => at(a.stats, rollIn(item[type][i]?.roll, affixWindow)))),
      ...parts.sockets.map((s) => socketPart(s, base, exactly(rollIn(s.roll, whole)), level)),
      ...(runeword ? [at(runeword.stats, rollIn(item.runewordRoll, whole))] : []),
      ...(infusion ? [at(infusion.stats, infusionRarity.maxPercent)] : []),
      ...parts.corrupted.map((a, i) => at(a.stats, rollIn(item.corruption!.affixes[i]?.roll, whole))),
    ],
  };
}

// OmenData.calcPiecesEquipped: a worn item counts toward its kind of rarity until the codex has
// enough of that kind, unless the codex wants its slot to hold another kind.
function piecesWorn(data: Gear, build: Build, codex: Codex) {
  const counted: Record<string, number> = {};
  for (const item of Object.values(build.gear)) {
    const base = data.bases.find((b) => b.id === item.base);
    const type = data.rarityTypes[item.unique ? data.uniqueRarity.id : item.rarity];
    if (!base || !type || codex.slots.some((req) => req.slot === base.slot && req.type !== type)) continue;
    if ((counted[type] ?? 0) < codex.pieces[type]) counted[type] = (counted[type] ?? 0) + 1;
  }
  return Object.values(counted).reduce((sum, n) => sum + n, 0);
}

// The build's codex as game data still knows it: what it gives, and how much of it the worn gear earns.
export function readCodex(data: Gear, build: Build) {
  const { codex } = build;
  const kind = codex && data.codex.kinds.find((k) => k.id === codex.id);
  if (!codex || !kind) return null;
  const tiers = data.rarities.filter((r) => !r.runewords);
  const rarity = tiers.find((r) => r.id === codex.rarity) ?? tiers.at(-1)!;
  const limits = data.codex.rarities[rarity.id];
  const slots = codex.slots.slice(0, limits.slots);
  const pool = data.codex.affixes.filter((a) => kind.affixTypes.includes(a.type));
  return {
    codex,
    kind,
    rarity,
    limits,
    slots,
    percent: codexPercent({ ...codex, slots }, limits.statMulti),
    pool,
    affixes: codex.affixes.flatMap((id) => pool.find((a) => a.id === id) ?? []).slice(0, limits.affixes),
    worn: piecesWorn(data, build, codex),
  };
}

// Sockets come from the talents that give one and from two uniques (JewelSocketStat).
export function jewelSockets(core: Core, build: Build) {
  const { trees, uniques } = core.jewelSockets;
  const talents = TREES.reduce((sum, tree) => sum + trees[tree].filter((node) => build.trees[tree].includes(node)).length, 0);
  const gear = Object.values(build.gear).reduce((sum, item) => {
    const gives = item.unique && uniques[item.unique];
    return gives ? sum + Math.trunc(gives.min + ((gives.max - gives.min) * (item.uniqueRolls?.[gives.stat] ?? 100)) / 100) : sum;
  }, 0);
  return Math.min(MAX_JEWELS, talents + gear);
}

// JewelBlueprint and UberBossTier: an Abyssal Eye is an intelligence jewel of unique rarity, with
// up to three affixes of its own on top. CraftedJewelTier: three of a crafted unique's six upgrades add an affix.
const UNIQUE_SLOTS = { crafted: 3, eye: 3 };

// What a jewel is, and the affixes it can hold: the ordinary ones of its colour, and the ones only its kind has.
export function describeJewel(data: Sections['sockets'], jewel: Jewel) {
  const { kinds, crafted, eye, affixes } = data.jewels;
  const unique = jewel.kind === 'crafted' || jewel.kind === 'eye';
  const kind = kinds.find((k) => k.id === (jewel.kind === 'eye' ? 'int' : jewel.kind));
  const rarity = unique ? null : (data.rarities.find((r) => r.id === jewel.rarity) ?? data.rarities.at(-1)!);
  return {
    item: jewel.kind === 'crafted' ? crafted : jewel.kind === 'eye' ? eye : kind!,
    rarity,
    // An affix is rolled no higher than the jewel's rarity, though an orb can raise it past that later.
    best: rarity?.maxPercent ?? 100,
    pool: kind ? affixes.jewel.filter((a) => a.tags.includes('any_jewel') || a.tags.includes(kind.tag)) : [],
    slots: jewel.kind === 'crafted' ? 0 : rarity ? jewelAffixes(rarity.affixCount) : 1,
    own: jewel.kind === 'crafted' ? affixes.crafted : jewel.kind === 'eye' ? affixes.eye : [],
    ownSlots: unique ? UNIQUE_SLOTS[jewel.kind as 'crafted' | 'eye'] : 0,
  };
}

// What each affix a jewel holds gives at its roll, and the augment that has to be on for it to count.
export function jewelParts(data: Sections['sockets'], jewel: Jewel): { part: Part; auraId: string }[] {
  const about = describeJewel(data, jewel);
  const placed = (held: Rolled[], pool: typeof about.pool, count: number) =>
    held
      .flatMap((a) => {
        const affix = pool.find((x) => x.id === a.id);
        return affix ? [{ part: { stats: affix.stats, rolls: exactly(a.roll ?? about.best), level: jewel.level }, auraId: affix.auraId }] : [];
      })
      .slice(0, count);
  return [...placed(jewel.affixes, about.pool, about.slots), ...placed(jewel.affixes, about.own, about.ownSlots), ...placed(jewel.corruption, data.jewels.affixes.corruption, 2)];
}

// A build made on another pack release can hold talents that no longer connect; those start over.
export function connected(tree: TalentTree, nodes: number[]): number[] {
  const taken = new Set(nodes.filter((n) => n < tree.nodes.length));
  return rooted(tree, neighbours(tree), taken).size === taken.size ? [...taken] : [];
}

export interface Totals {
  rules: Sections['stats'];
  stats: Map<string, Total>;
  // Why parts of the build give nothing.
  skipped: string[];
  // The gear the game takes off because the character falls short of the attributes it asks for.
  takenOff: Partial<Record<GearSlot, string>>;
  // The base of the weapon held, and whether a second one is held beside it.
  weapon?: string;
  dualWield: boolean;
  // Whether what is held in the off hand is a shield.
  shield: boolean;
  // The aura that is on, at the level the character has it.
  aura?: { id: string; name: string; rank: number; topRank: number };
  // The effects the build can turn on: those its skills give and those its stats do.
  effects: Held[];
  // The stacks of every effect the character is under: those that are on, the Retribution
  // stacks held and the aura that is on. And of every effect the enemy is under.
  under: { own: Record<string, number>; enemy: Record<string, number> };
  // The mob the build is set against: one affix or none for each its rarity rolls, and what the
  // aura and the effects that are on put on it.
  enemy: Pick<Enemy, 'level' | 'rarity' | 'affixes'> & { slots: string[]; marks: Exact[] };
}

// An effect a build can take to be on: on the character or on the enemy, the stacks of it that
// are on, the most it can have, and what it gives at those stacks.
export interface Held {
  // What it is saved under, and the effect it is: the same but for one listed for both sides.
  id: string;
  effect: string;
  name: string;
  enemy: boolean;
  // Effects of one kind push each other out.
  kind: string;
  max: number;
  stacks: number;
  stats: Exact[];
}

const exact = ({ stats, rolls, level }: Part): Exact[] => stats.map((s) => ({ id: s.id, type: s.type, value: rolled(s, rolls.maxPercent, level) }));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The Retribution stacks the build holds: only a Crusader gains any.
export const retributionHeld = (data: Pick<Data, 'skills'>, build: Build) => (build.classes.includes(RETRIBUTION.class) ? Math.min(data.skills.retribution.max, build.retribution) : 0);

// Everything that gives a character stats, as the game gathers it (StatCalculation.collectStatsWithCtx
// and CachedPlayerStats). What it takes from a weapon in the off hand depends on a stat of the
// character's own, so that is passed in. `extra` is what a skill adds for itself alone.
function gather(data: Data, build: Build, dualWield: number, extra: Exact[], off: Map<GearSlot, string>) {
  const { level } = build;
  const skipped: string[] = [];
  const others: Exact[] = [...extra, ...exact({ stats: data.stats.base, rolls: exactly(100), level }), ...newbieResists(level)];

  // GearData: gear above the character's level gives nothing, and a weapon in the off hand gives
  // a share of its stats when it is one that can be dual wielded beside a one-handed weapon.
  const mainHand = build.gear.weapon && readItem(data.gear, build.gear.weapon)?.base;
  const worn = GEAR_SLOTS.flatMap((slot) => {
    const item = build.gear[slot.id];
    const parts = item && readItem(data.gear, item);
    if (!parts || off.has(slot.id)) return [];
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
  // ExileEffect.getExactStats: every stack of an effect gives its stats again.
  const stacks = retributionHeld(data, build);
  if (stacks) others.push(...exact({ stats: data.skills.retribution.stats, rolls: exactly(100), level }).map((mod) => ({ ...mod, value: mod.value * stacks })));

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

// The attributes a worn item asks for that the character's stats fall short of.
export function unmet(data: Data, item: Item, stats: Map<string, Total>) {
  const base = data.gear.bases.find((b) => b.id === item.base);
  return base ? needsAt(base.needs, data.gear.requirement, item.level).filter((n) => n.value > (stats.get(n.stat)?.value ?? 0)) : [];
}

// The stats of everything gathered, with what a skill or an effect adds on top.
function settle(data: Data, build: Build, extra: Exact[]): Omit<Totals, 'effects' | 'under' | 'enemy'> {
  // UnequipGear and GearItemData.canPlayerWear: gear whose attributes the character's stats don't
  // reach is taken off, and the stats are worked out again without it, until all that is left is worn.
  const off = new Map<GearSlot, string>();
  for (;;) {
    // CachedEntityStats.afterStatCalc: the gear is gone over again until Dual Wield Effectiveness settles.
    let dualWield = 0;
    let found;
    for (let pass = 0; ; pass++) {
      const { sources, skipped, secondWeapon, weapon, shield } = gather(data, build, dualWield, extra, off);
      const stats = totalStats(data.stats, sources);
      const next = stats.get('dual_wield_effectiveness')?.value ?? 0;
      found = { rules: data.stats, stats, skipped: [...skipped, ...off.values()], weapon, dualWield: secondWeapon, shield, takenOff: Object.fromEntries(off) };
      if (!secondWeapon || Math.abs(next - dualWield) <= 0.01 || pass === 5) break;
      dualWield = next;
    }
    const short = GEAR_SLOTS.flatMap((slot) => {
      const item = build.gear[slot.id];
      const parts = item && !off.has(slot.id) && item.level <= build.level && readItem(data.gear, item);
      const lacking = parts ? unmet(data, item, found.stats) : [];
      const has = (stat: string) => Math.trunc(found.stats.get(stat)?.value ?? 0);
      const name = (stat: string) => data.stats.defs[stat]?.name ?? stat;
      return parts && lacking.length
        ? [[slot.id, `${nameOf(parts)} needs ${lacking.map((n) => `${n.value} ${name(n.stat)}`).join(' and ')} at level ${item!.level}, but the build has ${lacking.map((n) => `${has(n.stat)} ${name(n.stat)}`).join(' and ')}, so the game takes it off.`] as const]
        : [];
    });
    if (!short.length) return found;
    for (const [slot, reason] of short) off.set(slot, reason);
  }
}

// The skills the build has learned.
const known = (data: Data, build: Build) =>
  data.skills.classes
    .filter((c) => build.classes.includes(c.id))
    .flatMap((c) => c.perks)
    .flatMap((perk) => (perk.spell && build.perks[perk.id] > 0 ? [{ id: perk.id, spell: perk.spell }] : []));

// The aura the build has on: a skill it has learned. An aura that goes on pushes any other off (ExileEffect.onApply).
function auraOn(data: Data, build: Build) {
  const perk = known(data, build).find((p) => p.id === build.aura);
  const aura = data.skills.auras.find((a) => a.id === build.aura);
  return perk && aura ? { aura, spell: perk.spell } : null;
}

// What the whole build's stats come to, with what a skill adds for itself when that is given.
// `held` has the stacks of effects taken to be on whatever the build says: those a skill being
// worked out keeps on its caster.
export function buildTotals(data: Data, build: Build, extra: Exact[] = [], held: Record<string, number> = {}): Totals {
  // ExileEffect.getExactStats and ExilePotionEvent: an effect is as strong as the level of the
  // skill that gives it makes it, times its stacks, times what the stats of the character without
  // any of them add to effects of its kind, and the stats of the mob to those it is under.
  const before = settle(data, build, []);
  const level = (perk: { id: string; spell: Spell }) => {
    const topRank = perk.spell.maxLevel + data.skills.bonusLevels;
    const rank = build.perks[perk.id] + bonusSkillLevels(before.stats, perk.spell.tagIds, data.skills.bonusLevels);
    return { rank, topRank, percent: Math.trunc(leveled({ min: 0, max: 100 }, rank, topRank)) };
  };
  // A mob rolls as many affixes as its rarity has; the ones here are those that change its hits
  // or its defenses.
  const { mob } = data.defense;
  const rarity = mob.rarities.find((r) => r.id === build.enemy.rarity) ?? mob.rarities[0];
  const slots = Array.from({ length: rarity.affixes }, (_, i) => build.enemy.affixes[i] ?? '');
  const foe = { level: build.enemy.level ?? build.level, rarity, slots, affixes: slots.flatMap((id) => mob.affixes.find((a) => a.id === id) ?? []) };
  const bare = mobStats(data.defense, data.stats, foe, []);
  const stronger = (ids: string[], stats = before.stats) => ids.reduce((sum, id) => sum + (stats.get(id)?.value ?? 0), 0);
  const given = (effect: Data['skills']['auras'][number]['effects'][number], percent: number, stacks = 1) => {
    const multi = stacks * (1 + (stronger(effect.given) + stronger(effect.onYou, effect.enemy ? bare : before.stats)) / 100);
    return exact({ stats: effect.stats, rolls: exactly(percent), level: build.level }).map((mod) => ({ ...mod, value: mod.value * multi }));
  };

  const learned = known(data, build);
  const kinds = new Set<string>();
  const hold = (effect: Data['skills']['effects'][number]): Held => {
    // ExilePotionEvent and MaximumChargesStat: stacks stop at the most the one under the effect can have.
    const max = effect.max + (effect.enemy ? 0 : Math.trunc(before.stats.get(`max_${effect.effect}_charges`)?.value ?? 0));
    // ExileEffect.onApply: one that goes on pushes the others of its kind off.
    const stacks = effect.kind && kinds.has(effect.kind) ? 0 : Math.min(max, held[effect.id] ?? build.effects[effect.id] ?? 0);
    if (stacks) kinds.add(effect.kind);
    // One that no learned skill gives is at the lowest level (LeveledValue.getValue). What a stat
    // gives is at the level of the spell whose hit gave it, the lowest when none did
    // (GiveExileStatusEffect), and is taken at the lowest: of those that grow with level, a
    // character can only have the ones a skill of its own gives too.
    const percent = Math.max(0, ...learned.filter((perk) => effect.from.includes(perk.id)).map((perk) => level(perk).percent));
    // ExileEffect.getExactStats: one whose stacks don't change its stats gives them once.
    return { id: effect.id, effect: effect.effect, name: effect.name, enemy: effect.enemy, kind: effect.kind, max, stacks, stats: stacks ? given(effect, percent, effect.once ? 1 : stacks) : [] };
  };
  // EffectEvent.AddEffects: a skill's hit is made with the skill's own stats and the support gems
  // of its slot, so what those give on a hit is the character's to gain as well.
  const cast = learned.flatMap((perk) => [...perk.spell.stats, ...(build.hotbar.find((slot) => slot?.spell === perk.id)?.supports ?? []).flatMap((gem) => data.skills.supports.find((s) => s.id === gem.id)?.stats ?? [])]);
  // What is offered follows the build: the effects of its learned skills, and those a stat of
  // the character gives.
  const offered = (effect: Data['skills']['effects'][number]) =>
    effect.id in held || learned.some((perk) => effect.from.includes(perk.id) || effect.asked.includes(perk.id)) || effect.by.some((stat) => (before.stats.get(stat)?.value ?? 0) > 0 || cast.some((mod) => mod.id === stat));
  const first = data.skills.effects.filter(offered).map(hold);

  const on = auraOn(data, build);
  const at = on && level({ id: on.aura.id, spell: on.spell });
  const lit = (enemy: boolean) => (on ? on.aura.effects.filter((effect) => effect.enemy === enemy).flatMap((effect) => given(effect, at!.percent)) : []);
  // An effect that is on, or the aura, can give the stat that gives a further effect: one more
  // round finds those.
  const lent = [...first.flatMap((effect) => (effect.enemy ? [] : effect.stats)), ...lit(false)];
  const second = data.skills.effects.filter((effect) => !offered(effect) && effect.by.some((stat) => lent.some((mod) => mod.id === stat && mod.value > 0))).map(hold);
  const effects = [...first, ...second].sort((a, b) => a.name.localeCompare(b.name));
  const stacksOf = (enemy: boolean) => Object.fromEntries(effects.filter((effect) => effect.enemy === enemy && effect.stacks).map((effect) => [effect.effect, effect.stacks]));
  const added = [...effects.flatMap((effect) => (effect.enemy ? [] : effect.stats)), ...lit(false)];
  return {
    ...(extra.length || added.length ? settle(data, build, [...extra, ...added]) : before),
    ...(on && { aura: { id: on.aura.id, name: on.spell.name, rank: at!.rank, topRank: at!.topRank } }),
    effects,
    under: { own: { ...stacksOf(false), [RETRIBUTION.effect]: retributionHeld(data, build), ...(on && { [on.aura.effect]: 1 }) }, enemy: stacksOf(true) },
    enemy: { ...foe, marks: [...lit(true), ...effects.flatMap((effect) => (effect.enemy ? effect.stats : []))] },
  };
}

// A total written the way the site writes any stat. A damage stat's "more" multipliers get a line of their own.
export function totalLines(id: string, def: StatDef, total: Total) {
  const mod: StatMod = { id, name: def.name, desc: '', type: 'FLAT', min: 0, max: 0, percent: def.percent, long: def.long, scaling: null };
  const more = (total.more - 1) * 100;
  return [...(total.value !== 0 || more === 0 ? [formatRange(mod, total.value, total.value)] : []), ...(more !== 0 ? [formatRange({ ...mod, type: 'MORE' }, more, more)] : [])];
}

// The stats that came to something, in the game's own groups.
export function statGroups({ rules, stats }: Totals) {
  const listed = new Set([...rules.main, ...rules.groups.flatMap((group) => group.ids)]);
  // Like the game's own list, the rest leaves out stats that read as a sentence: what they do is already in the numbers.
  const others = [...stats.keys()].filter((id) => !listed.has(id) && !rules.defs[id].hidden && !rules.defs[id].long).sort((a, b) => rules.defs[a].name.localeCompare(rules.defs[b].name));
  return [...rules.groups, { name: 'Other', ids: others }].map((group) => ({
    name: group.name,
    rows: group.ids.flatMap((id) => {
      const total = stats.get(id);
      // A stat nothing has touched isn't there, and one that came to nothing isn't worth a line.
      if (!total || (total.value === 0 && total.more === 1)) return [];
      return totalLines(id, rules.defs[id], total);
    }),
  }));
}

// What the skill picked for the build deals.
export function buildDamage(data: Data & Pick<Sections, 'damage'>, build: Build) {
  const { damage: rules, skills } = data;
  const own = buildTotals(data, build);
  const { level } = build;

  // Skills on the hotbar that deal damage themselves or through the pets they summon.
  const perks = skills.classes.filter((c) => build.classes.includes(c.id)).flatMap((c) => c.perks);
  const choices = build.hotbar.flatMap((slot) => {
    const perk = perks.find((p) => p.id === slot?.spell);
    return slot && perk?.spell && build.perks[perk.id] > 0 && rules.skills[perk.id] ? [{ slot, perk, spell: perk.spell }] : [];
  });
  const chosen = choices.find((c) => c.perk.id === build.damage.skill);

  const fighter = (unit: Map<string, Total>): Fighter => ({ level, own: own.stats, unit, weapon: (own.weapon && rules.weapons[own.weapon]) || UNARMED, dualWield: own.dualWield, effects: own.under.own });
  const spellOf = (id: string) => skills.classes.flatMap((c) => c.perks).find((p) => p.id === id)?.spell;
  // SpellCastingData.calcSpellLevels: the level the character has a skill at, none where it hasn't learned it.
  const rankOf = (id: string) => {
    const learned = build.perks[id] ?? 0;
    return learned && learned + bonusSkillLevels(own.stats, spellOf(id)!.tagIds, skills.bonusLevels);
  };
  // Spell.getStats: a skill's level as a whole percentage of the most it can be.
  const share = (rank: number, topRank: number) => Math.trunc(Math.fround(rank / topRank) * 100);
  const exact = (stats: StatMod[], roll: number) => stats.map((s): Exact => ({ id: s.id, type: s.type, value: rolled(s, roll, level) }));
  const gems = (id: string) => (build.hotbar.find((slot) => slot?.spell === id)?.supports ?? []).flatMap((gem) => exact(skills.supports.find((s) => s.id === gem.id)?.stats ?? [], gem.roll ?? 100));
  // The one using a skill with `extra` on top of the character's stats, and as it is under an
  // effect the skill leaves on it, with the stats of the stacks that come to: all it can hold
  // when one use renews what the last left, or else what a use adds (ExilePotionEvent).
  const user = (extra: Exact[]) => {
    const who = fighter(buildTotals(data, build, extra).stats);
    const holding = (gift: Gift, kept: boolean) => {
      const effect = skills.effects.find((e) => e.effect === gift.effect && !e.enemy);
      if (gift.enemy || !effect?.stats.length) return who;
      const under = buildTotals(data, build, extra, { [effect.id]: kept ? Infinity : gift.stacks });
      return { ...fighter(under.stats), effects: under.under.own };
    };
    return { who, holding };
  };
  // StatCalculation.calc: a skill is used at the level the character has it, with its own stats
  // and the support gems of its hotbar slot on top of the character's.
  const used = (id: string) => {
    const spell = spellOf(id)!;
    const topRank = spell.maxLevel + skills.bonusLevels;
    const rank = rankOf(id);
    const percent = share(rank, topRank);
    const extra = [...exact(spell.stats, percent), ...gems(id)];
    return { skill: rules.skills[id], ...user(extra), rank, topRank, percent };
  };
  // ProcSpellEffect: a class skill that is set off is cast as the character has it, at no level
  // where it hasn't learned it. A spell no class teaches is cast at the level of the skill it
  // goes by, with that skill's stats and support gems on top of its own.
  const setOff = (id: string): Used => {
    const { skill = rules.skills[id], own: spell } = rules.procs[id];
    if (!spell) return { ...used(id), skill };
    const topRank = spell.maxLevel + skills.bonusLevels;
    const rank = Math.max(spell.minRank, rankOf(spell.levelOf));
    const lent = spell.supportsOf === id ? undefined : spellOf(spell.supportsOf);
    const extra = [...exact(spell.stats, share(rank, topRank)), ...(lent ? exact(lent.stats, share(rankOf(spell.supportsOf), lent.maxLevel + skills.bonusLevels)) : []), ...gems(spell.supportsOf)];
    return { skill, ...user(extra), rank, topRank };
  };
  const use = chosen && used(chosen.perk.id);
  const who = use?.who ?? fighter(own.stats);

  // A skill is used in the form the effects on its caster call for. Where it deals nothing
  // under them, it is worked out in the form that takes the fewest, as if those were on. One
  // that does more for Retribution spends stacks whenever any is held, as many as its script takes.
  const stacks = own.under.own[RETRIBUTION.effect];
  const spends = !!use?.skill.variants.some((variant) => variant.retribution);
  const fits = use && formOf(use.skill, who.effects);
  const form = use && (fits ?? use.skill.variants[0]);
  const forced = !!form && !fits;
  const perCast = form?.retribution || use?.skill.variants.find((variant) => variant.retribution)?.retribution || 0;

  // The enemy has a mob's stats, and what the skill, the aura and the effects that are on put on
  // it at their level (ExileEffect.getExactStats).
  const marks = [...(use ? (form!.marks ?? []).map((mark): Exact => ({ id: mark.id, type: mark.type, value: rolled(mark, use.percent, level) })) : []), ...own.enemy.marks];
  const enemy = { level: own.enemy.level, stats: mobStats(data.defense, data.stats, own.enemy, marks), rules: rules.taken, effects: own.under.enemy, count: build.damage.targets ?? TARGETS.standard };
  // The skills its pets may cast, which no hotbar slot has to hold.
  const cast: Record<string, Used> = Object.fromEntries((use?.skill.pets?.spells ?? []).map((id) => [id, used(id)]));
  const damage = use ? skillDamage(rules, use, enemy, form!, cast) : attackDamage(rules, who, enemy, build.damage.attacks ?? attackRate(who));
  // An aura that is on deals what it does beside whatever is used, as a spell of its own skill.
  const hits = own.aura ? rules.auras[own.aura.id].hits : [];
  const aura = own.aura && { name: own.aura.name, damage: hits.length ? effectDamage(rules, rules.auras[own.aura.id], hits, used(own.aura.id), enemy) : undefined };
  // So does an effect that is on whose own script deals damage, as a spell of the skill that
  // gave it (ExileEffectInstanceData): the one being used where that gives it, or else the one
  // the build has at the highest level. Its ticks come without pause, so it never ends, and what
  // a basic attack sets off comes with every one that lands and deals damage (DamageEvent.activate).
  const struck = use || !damage.total ? 0 : damage.rate * damage.lands;
  const lasting = own.effects.flatMap((held) => {
    const from = held.stacks ? Object.keys(rules.lasting[held.id] ?? {}).filter((id) => rankOf(id) > 0) : [];
    const giver = chosen && from.includes(chosen.perk.id) ? chosen.perk.id : from.sort((a, b) => rankOf(b) - rankOf(a))[0];
    const dealt = (rules.lasting[held.id]?.[giver]?.hits ?? []).flatMap((hit): SkillHit[] => (hit.when === 'aura' ? [hit] : struck ? [{ ...hit, count: hit.count * struck }] : []));
    return dealt.length ? [{ name: held.name, damage: effectDamage(rules, rules.lasting[held.id][giver], dealt, used(giver), enemy) }] : [];
  });
  const others = [...(aura?.damage ? [aura.damage] : []), ...lasting.map((effect) => effect.damage)];
  // The spells that all those hits set off, the one that deals the most first.
  const setOffBy = (main: Damage) =>
    Object.entries(procDamage(rules, [main, ...others], enemy, setOff, damage.pets === undefined ? undefined : true))
      .map(([id, dealt]) => ({ name: rules.procs[id].name, damage: dealt }))
      .sort((a, b) => b.damage.dps - a.damage.dps);
  const procs = setOffBy(damage);
  const all = [damage, ...others, ...procs.map((proc) => proc.damage)];
  const dps = all.reduce((sum, dealt) => sum + dealt.dps, 0);
  // What each element comes to a second, the most first.
  const perSecond: ByElement = {};
  for (const { perUse, rate } of all) {
    for (const [element, value] of Object.entries(perUse) as [Element, number][]) perSecond[element] = (perSecond[element] ?? 0) + value * rate;
  }
  const elements = (Object.entries(perSecond) as [Element, number][]).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  // The stats the hit is made with.
  const stats = who.unit;
  const crit = Math.min(100, Math.max(0, stats.get('critical_hit')?.value ?? 0));

  // What using the skill costs: each cast of a summon skill, which keeps its pets out, and each
  // of its pets' attacks, which its user casts through the pet (PetAttackUTIL), each use of any
  // other skill, or each basic attack. A set-off spell costs nothing (ProcSpellEffect).
  const summon = use?.skill.pets;
  const cost = use ? useCost(rules, skills.costScaling, use, use.skill, chosen!.spell, use.skill.channel) : attackCost(rules, who, damage.rate);
  const petCost = summon && useCost(rules, skills.costScaling, use, summon, summon.cost, false);
  const spent: ByResource = {};
  addTo(spent, cost, damage.casts ?? damage.rate);
  if (petCost) addTo(spent, petCost, damage.rate);
  // What comes back while fighting: what is regenerated, and what hits leech, those that come
  // whatever is used apart from those that come with its uses.
  const leech = (list: Damage[]) => {
    const out: ByResource = {};
    for (const { restores, rate } of list) addTo(out, restores, rate);
    return out;
  };
  const sustained = sustain(own.stats, spent, regenerated(rules, fighter(own.stats)), leech(others), leech([damage, ...procs.map((proc) => proc.damage)]));
  // What is kept up once the first pool to run out is empty: the skill used as often as what comes back pays for.
  const slower = { ...damage, rate: damage.rate * sustained.pace, dps: damage.dps * sustained.pace };
  const kept = sustained.pace < 1 ? [slower, ...others, ...setOffBy(slower).map((proc) => proc.damage)].reduce((sum, dealt) => sum + dealt.dps, 0) : dps;
  const resources = { ...sustained, cost, petCost, spent, kept };
  return { rules, own, choices, chosen, form, forced, enemy, damage, aura, lasting, procs, dps, elements, stats, crit, retribution: { stacks, spends, spent: perCast, name: skills.retribution.name }, resources, targets: { count: enemy.count, area: [damage, aura?.damage, ...lasting.map((e) => e.damage), ...procs.map((p) => p.damage)].some((d) => d?.parts.some((part) => part.hit?.area)) } };
}

const HITS: Element[] = ['Physical', 'Fire', 'Cold', 'Nature', 'Shadow'];

// How the build holds up against the enemy set for it, with what comes back while it uses `attack`'s skill.
export function buildDefense({ damage, defense: rules }: Pick<Sections, 'damage' | 'defense'>, build: Build, attack: ReturnType<typeof buildDamage>) {
  const totals = attack.own;
  const { stats, shield } = totals;
  const value = (id: string) => stats.get(id)?.value ?? 0;

  const enemy = { ...totals.enemy, ...build.defense, effects: totals.under.enemy };
  // What the aura and the effects that are on put on the mob count among its stats (ExileEffect.getExactStats).
  const mob = mobStats(rules, totals.rules, enemy, enemy.marks);
  const pierces = (id: string) => mob.get(id)?.value ?? 0;

  // What the aura that is on deals its own caster a second. Every player has a stat that keeps
  // the caster's stats off a hit its self-damaging skill deals it (DefenseStats.NO_SELF_DAMAGE_STATS),
  // so only its defenses act on it.
  const aura = totals.aura && damage.auras[totals.aura.id];
  const caster: Fighter = { level: build.level, own: stats, unit: new Map(), weapon: UNARMED, dualWield: false, effects: totals.under.own };
  const cost = aura?.self.length ? effectDamage(damage, aura, aura.self, { ...totals.aura!, who: caster }, { level: build.level, stats, rules: rules.taken, effects: totals.under.own, self: true }).dps : 0;
  // The health and magic shield that come back a second while the skill is used, less what the aura takes.
  const { held } = attack.resources;
  const healed = held.health + held.magic_shield - cost;

  const avoid = avoidance(rules, stats, enemy, mob, shield);
  const rows = HITS.map((element) => {
    const { id } = ELEMENTS[element];
    // The share of the hit that armor stops, or the resistance that counts against it and the whole of it, in percent.
    const resisted =
      element === 'Physical'
        ? { used: armorShare(rules.scaling, value('armor'), pierces('armor_penetration'), enemy.level) * 100, all: 0 }
        : { used: resistance(stats, id, pierces(`${id}_penetration`)), all: Math.trunc(value(`${id}_resist`)) };
    return { element, resisted, ...taken(rules, build.level, stats, totals.under.own, enemy, mob, avoid, element, healed) };
  });
  const weakest = rows.reduce((low, row) => (row.effectiveHealth < low.effectiveHealth ? row : low));
  // The hits it lasts the shortest against.
  const shortest = rows.reduce((low, row) => (row.lasts < low.lasts ? row : low));
  return { rules, totals, value, enemy, avoid, rows, weakest, shortest, held, healed, aura: totals.aura && { name: totals.aura.name, cost } };
}

export const show = (n: number) => (!Number.isFinite(n) ? '∞' : n >= 100 ? Math.round(n).toLocaleString('en') : `${+n.toFixed(1)}`);
export const percent = (share: number) => `${+(share * 100).toFixed(1)}%`;
// A resistance, with the whole of it where a cap or the enemy's penetration keeps some from counting.
export const resistText = ({ used, all }: { used: number; all: number }) => (all > used ? `${used}% of ${all}%` : `${used}%`);

// Client-safe: what a build comes to, worked out from the game data the editor fetches: the parts
// of it the pack still knows, its stats, and what it deals and takes. Like affix.ts, no data imports here.
import { canRoll, formatRange, rolled, type StatMod } from './affix';
import {
  GEAR_SLOTS,
  MAX_JEWELS,
  OFFHAND_WEAPON_PERCENT,
  RESISTS,
  RETRIBUTION,
  SOLO_CLASS,
  TREES,
  codexBonuses,
  codexPercent,
  exactly,
  jewelAffixes,
  rollIn,
  type Build,
  type Codex,
  type Item,
  type Jewel,
  type Rolled,
} from './buildRules';
import type { Core, Sections } from './builds';
import { ELEMENTS, UNARMED, armorShare, attackDamage, attackRate, auraDamage, resistance, skillDamage, type ByElement, type Element, type Fighter, type Used } from './damageRules';
import { avoidance, mobStats, taken } from './defenseRules';
import { MODIFIES, baseRange, formedRuneword, itemName, rollWindows, slotCount, socketPart, type Part, type Socketed } from './plannerRules';
import { leveled } from './spellRules';
import { bonusSkillLevels, newbieResists, totalStats, type Exact, type Source, type StatDef, type Total } from './statRules';
import { neighbours, rooted } from './talentRules';
import type { TalentTree } from './talents';

type Gear = Sections['gear'];
// The game data a build's stats are worked out from.
export type Data = Omit<Sections, 'damage' | 'defense'>;

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
  // The base of the weapon held, and whether a second one is held beside it.
  weapon?: string;
  dualWield: boolean;
  // Whether what is held in the off hand is a shield.
  shield: boolean;
  // The aura that is on, at the level the character has it, and what it puts on enemies in reach.
  aura?: { id: string; name: string; rank: number; topRank: number; marks: Exact[] };
}

const exact = ({ stats, rolls, level }: Part): Exact[] => stats.map((s) => ({ id: s.id, type: s.type, value: rolled(s, rolls.maxPercent, level) }));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The Retribution stacks the build holds: only a Crusader gains any.
export const retributionHeld = (data: Pick<Data, 'skills'>, build: Build) => (build.classes.includes(RETRIBUTION.class) ? Math.min(data.skills.retribution.max, build.retribution) : 0);

// Everything that gives a character stats, as the game gathers it (StatCalculation.collectStatsWithCtx
// and CachedPlayerStats). What it takes from a weapon in the off hand depends on a stat of the
// character's own, so that is passed in. `extra` is what a skill adds for itself alone.
function gather(data: Data, build: Build, dualWield: number, extra: Exact[]) {
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

// The stats of everything gathered, with what a skill or an effect adds on top.
function settle(data: Data, build: Build, extra: Exact[]): Totals {
  // CachedEntityStats.afterStatCalc: the gear is gone over again until Dual Wield Effectiveness settles.
  let dualWield = 0;
  for (let pass = 0; ; pass++) {
    const { sources, skipped, secondWeapon, weapon, shield } = gather(data, build, dualWield, extra);
    const stats = totalStats(data.stats, sources);
    const next = stats.get('dual_wield_effectiveness')?.value ?? 0;
    if (!secondWeapon || Math.abs(next - dualWield) <= 0.01 || pass === 5) return { rules: data.stats, stats, skipped, weapon, dualWield: secondWeapon, shield };
    dualWield = next;
  }
}

// The aura the build has on: a skill it has learned. An aura that goes on pushes any other off (ExileEffect.onApply).
function auraOn(data: Data, build: Build) {
  const perks = data.skills.classes.filter((c) => build.classes.includes(c.id)).flatMap((c) => c.perks);
  const perk = perks.find((p) => p.id === build.aura && p.spell && build.perks[p.id] > 0);
  const aura = data.skills.auras.find((a) => a.id === build.aura);
  return perk && aura ? { aura, spell: perk.spell! } : null;
}

// What the whole build's stats come to, with what a skill adds for itself when that is given.
export function buildTotals(data: Data, build: Build, extra: Exact[] = []): Totals {
  const on = auraOn(data, build);
  if (!on) return settle(data, build, extra);
  // ExileEffect.getExactStats and ExilePotionEvent: an aura's effects are as strong as the skill's
  // level makes them, times what the stats of the character without them add to effects of their kind.
  const { aura, spell } = on;
  const before = settle(data, build, []).stats;
  const topRank = spell.maxLevel + data.skills.bonusLevels;
  const rank = build.perks[aura.id] + bonusSkillLevels(before, spell.tagIds, data.skills.bonusLevels);
  const percent = Math.trunc(leveled({ min: 0, max: 100 }, rank, topRank));
  const stronger = (ids: string[]) => ids.reduce((sum, id) => sum + (before.get(id)?.value ?? 0), 0);
  const given = (enemy: boolean) =>
    aura.effects
      .filter((effect) => effect.enemy === enemy)
      .flatMap((effect) => {
        const multi = 1 + (stronger(effect.given) + (enemy ? 0 : stronger(effect.onYou))) / 100;
        return exact({ stats: effect.stats, rolls: exactly(percent), level: build.level }).map((mod) => ({ ...mod, value: mod.value * multi }));
      });
  return { ...settle(data, build, [...extra, ...given(false)]), aura: { id: aura.id, name: spell.name, rank, topRank, marks: given(true) } };
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
  const { target } = build.damage;

  // Skills on the hotbar that deal damage themselves or through the pets they summon.
  const perks = skills.classes.filter((c) => build.classes.includes(c.id)).flatMap((c) => c.perks);
  const choices = build.hotbar.flatMap((slot) => {
    const perk = perks.find((p) => p.id === slot?.spell);
    return slot && perk?.spell && build.perks[perk.id] > 0 && rules.skills[perk.id] ? [{ slot, perk, spell: perk.spell }] : [];
  });
  const chosen = choices.find((c) => c.perk.id === build.damage.skill);

  const fighter = (unit: Map<string, Total>): Fighter => ({ level, own: own.stats, unit, weapon: (own.weapon && rules.weapons[own.weapon]) || UNARMED, dualWield: own.dualWield });
  // StatCalculation.calc: a skill is used at the level the character has it, with its own stats
  // and the support gems of its hotbar slot on top of the character's.
  const used = (id: string) => {
    const spell = skills.classes.flatMap((c) => c.perks).find((p) => p.id === id)!.spell!;
    const topRank = spell.maxLevel + skills.bonusLevels;
    const learned = build.perks[id] ?? 0;
    const rank = learned && learned + bonusSkillLevels(own.stats, spell.tagIds, skills.bonusLevels);
    const percent = Math.trunc(Math.fround(rank / topRank) * 100);
    const exact = (stats: StatMod[], roll: number) => stats.map((s): Exact => ({ id: s.id, type: s.type, value: rolled(s, roll, level) }));
    const supports = build.hotbar.find((slot) => slot?.spell === id)?.supports ?? [];
    const extra = [...exact(spell.stats, percent), ...supports.flatMap((gem) => exact(skills.supports.find((s) => s.id === gem.id)?.stats ?? [], gem.roll ?? 100))];
    return { skill: rules.skills[id], who: fighter(buildTotals(data, build, extra).stats), rank, topRank, percent };
  };
  const use = chosen && used(chosen.perk.id);
  const who = use?.who ?? fighter(own.stats);

  // The states a skill can be used in go by the effects they take. One that does more for a
  // Retribution stack spends one whenever any is held.
  const stacks = retributionHeld(data, build);
  const states = use?.skill.variants ?? [];
  const spends = states.some((variant) => variant.retribution);
  const variants = states.filter((variant) => !!variant.retribution === (spends && stacks > 0)).map((variant) => ({ variant, name: variant.needs.join(' and ') }));
  const under = variants.find((v) => v.name === build.damage.under) ?? variants[0];

  // The target has armor and resistances, and what the skill and the aura that is on put on it at
  // their level (ExileEffect.getExactStats).
  const marks = [...(use ? (under.variant.marks ?? []).map((mark) => [mark.id, rolled(mark, use.percent, level)] as const) : []), ...(own.aura?.marks ?? []).map((mark) => [mark.id, mark.value] as const)];
  const defenses = [['armor', target.armor] as const, ...RESISTS.map((id) => [`${id}_resist`, target.resists[id] ?? 0] as const), ...marks];
  const enemy = { level: target.level ?? level, stats: new Map(defenses.map(([id, value]) => [id, { value, more: 1 }])), rules: rules.taken };
  // The skills its pets may cast, which no hotbar slot has to hold.
  const cast: Record<string, Used> = Object.fromEntries((use?.skill.pets?.spells ?? []).map((id) => [id, used(id)]));
  const damage = use ? skillDamage(rules, use, enemy, under.variant, cast) : attackDamage(rules, who, enemy, build.damage.attacks ?? attackRate(who));
  // An aura that is on deals what it does beside whatever is used, as a spell of its own skill.
  const hits = own.aura ? rules.auras[own.aura.id].hits : [];
  const aura = own.aura && { name: own.aura.name, damage: hits.length ? auraDamage(rules, rules.auras[own.aura.id], hits, used(own.aura.id), enemy) : undefined };
  const dps = damage.dps + (aura?.damage?.dps ?? 0);
  // What each element comes to a second, the most first.
  const perSecond: ByElement = {};
  for (const [dealt, rate] of [[damage.perUse, damage.rate], [aura?.damage?.perUse ?? {}, 1]] as const) {
    for (const [element, value] of Object.entries(dealt) as [Element, number][]) perSecond[element] = (perSecond[element] ?? 0) + value * rate;
  }
  const elements = (Object.entries(perSecond) as [Element, number][]).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  // The stats the hit is made with.
  const stats = who.unit;
  const crit = Math.min(100, Math.max(0, stats.get('critical_hit')?.value ?? 0));
  return { rules, own, choices, chosen, variants, under, enemy, damage, aura, dps, elements, stats, crit, retribution: { stacks, spends, name: skills.retribution.name } };
}

const HITS: Element[] = ['Physical', 'Fire', 'Cold', 'Nature', 'Shadow'];

// How the build holds up against the enemy set for it.
export function buildDefense({ damage, defense: rules }: Pick<Sections, 'damage' | 'defense'>, build: Build, totals: Totals) {
  const { stats, shield } = totals;
  const value = (id: string) => stats.get(id)?.value ?? 0;

  // A mob rolls as many affixes as its rarity has; the ones here are those that change its hits.
  const rarity = rules.mob.rarities.find((r) => r.id === build.defense.rarity) ?? rules.mob.rarities[0];
  const slots = Array.from({ length: rarity.affixes }, (_, i) => build.defense.affixes[i] ?? '');
  const affixes = slots.flatMap((id) => rules.mob.affixes.find((a) => a.id === id) ?? []);
  const enemy = { ...build.defense, level: build.defense.level ?? build.level, rarity, affixes };
  const mob = mobStats(rules, totals.rules, enemy);
  const pierces = (id: string) => mob.get(id)?.value ?? 0;

  const avoid = avoidance(rules, stats, enemy, mob, shield);
  const rows = HITS.map((element) => {
    const { id } = ELEMENTS[element];
    // The share of the hit that armor stops, or the resistance that counts against it and the whole of it, in percent.
    const resisted =
      element === 'Physical'
        ? { used: armorShare(rules.scaling, value('armor'), pierces('armor_penetration'), enemy.level) * 100, all: 0 }
        : { used: resistance(stats, id, pierces(`${id}_penetration`)), all: Math.trunc(value(`${id}_resist`)) };
    return { element, resisted, ...taken(rules, build.level, stats, enemy, mob, avoid, element) };
  });
  const weakest = rows.reduce((low, row) => (row.effectiveHealth < low.effectiveHealth ? row : low));

  // What the aura that is on deals its own caster a second. Every player has a stat that keeps
  // the caster's stats off a hit its self-damaging skill deals it (DefenseStats.NO_SELF_DAMAGE_STATS),
  // so only its defenses act on it.
  const aura = totals.aura && damage.auras[totals.aura.id];
  const caster: Fighter = { level: build.level, own: stats, unit: new Map(), weapon: UNARMED, dualWield: false };
  const cost = aura?.self.length ? auraDamage(damage, aura, aura.self, { ...totals.aura!, who: caster }, { level: build.level, stats, rules: rules.taken }).dps : 0;
  return { rules, totals, value, rarity, slots, enemy, avoid, rows, weakest, aura: totals.aura && { name: totals.aura.name, cost } };
}

export const show = (n: number) => (!Number.isFinite(n) ? '∞' : n >= 100 ? Math.round(n).toLocaleString('en') : `${+n.toFixed(1)}`);
export const percent = (share: number) => `${+(share * 100).toFixed(1)}%`;
// A resistance, with the whole of it where a cap or the enemy's penetration keeps some from counting.
export const resistText = ({ used, all }: { used: number; all: number }) => (all > used ? `${used}% of ${all}%` : `${used}%`);

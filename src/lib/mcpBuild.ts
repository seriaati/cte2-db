// Server-side only: the build tool of functions/mcp.ts. It reads a whole build given by names or
// ids, says what the game wouldn't allow about it, and reports what the build editor works out for it.
import { canRoll, type StatMod } from './affix';
import { buildDamage, buildDefense, buildTotals, describeJewel, jewelSockets, nameOf, percent, readCodex, readItem, resistText, show as amount, statGroups } from './buildCalc';
import {
  AUGMENT_SLOTS,
  GEAR_SLOTS,
  MAX_CLASSES,
  RARITY_TYPES,
  RESISTS,
  RETRIBUTION,
  TREES as TREE_IDS,
  exactly,
  exportBuild,
  maxRank,
  needsAt,
  pointsAt,
  readBuild,
  supportSlots,
  type Build,
  type Codex,
  type GearSlot,
  type Item,
  type Jewel,
  type Pool,
  type RarityType,
  type Rolled,
  type TreeId,
  codexBonuses,
} from './buildRules';
import { core, sections } from './builds';
import { ELEMENTS, resistance, volleysMissed, type Resource } from './damageRules';
import { TREES, addedLine, planTree, show, statLines } from './mcp';
import { slotCount } from './plannerRules';
import { augmentCapacity, augmentCost } from './statRules';

const { gear, skills, sockets, defense } = sections;
const { maxLevel } = core;
const tiers = gear.rarities.filter((r) => !r.runewords);
const top = tiers.at(-1)!;

// A part of the build by name or id, with its roll when that isn't the best.
type Given = string | { id: string; roll?: number };

export interface GivenItem {
  base?: string;
  unique?: string;
  rarity?: string;
  level?: number;
  baseRoll?: number;
  quality?: number;
  implicit?: Given;
  prefix?: Given[];
  suffix?: Given[];
  uniqueRolls?: number[];
  sockets?: (string | { kind?: 'gem' | 'rune'; id: string; roll?: number })[];
  runewordRoll?: number;
  infusion?: string | { id: string; rarity?: string };
  corruption?: { kind: string; affixes?: Given[] };
  enchants?: { id: string; level: number }[];
}

type GivenCodex = { id: string; rarity?: string; level?: number; pieces?: Partial<Record<RarityType, number>>; slots?: { slot: string; type: RarityType }[]; affixes?: string[] };

// The build of an exported file, with names allowed where it has ids and everything left out that isn't wanted.
export interface GivenBuild {
  name?: string;
  level?: number;
  bonus?: Partial<Record<Pool, number>>;
  trees?: Partial<Record<TreeId, (number | string)[]>>;
  stats?: Record<string, number>;
  classes?: string[];
  perks?: Record<string, number>;
  hotbar?: ({ spell: string; supports?: Given[] } | null)[];
  gear?: Partial<Record<GearSlot, GivenItem>>;
  codex?: GivenCodex | null;
  augments?: Given[];
  jewels?: { kind: string; rarity?: string; level?: number; affixes?: Given[]; corruption?: Given[] }[];
  damage?: { skill?: string; attacks?: number; targets?: number };
  enemy?: { level?: number; rarity?: string; affixes?: string[] };
  defense?: { hit?: number; rate?: number };
  retribution?: number;
  aura?: string;
  effects?: Record<string, number>;
  defensive?: string[];
}

interface Named {
  id: string;
  name?: string;
  stats?: StatMod[];
}

const idOf = (given: Given) => (typeof given === 'string' ? given : given.id);
const rollOf = (given: Given) => (typeof given === 'string' ? undefined : given.roll);

// Infusions, passives and the affixes of jewels, corruption and codexes have no names in game, so
// each goes by the stats it gives.
const nameless = (x: Named) => !x.name || x.name === x.id;
const label = (x: Named) => (nameless(x) && x.stats?.length ? x.stats.map((s) => s.name).join(' and ') : x.name || x.id);
// Lists no longer than this are spelled out when nothing in them matches.
const LISTED = 60;

// One of a list by its id, by its name, or where it has none by a stat it gives. `what` says what
// the list holds, for the problem that is noted when nothing or more than one thing matches.
function pick<T extends Named>(pool: T[], given: string, what: string, problems: string[]): T | undefined {
  const wanted = given.trim().toLowerCase();
  const stat = (x: T, test: (name: string) => boolean) => nameless(x) && !!x.stats?.some((s) => test(s.name.toLowerCase()));
  const found =
    [
      (x: T) => x.id.toLowerCase() === wanted,
      (x: T) => (nameless(x) ? stat(x, (name) => name === wanted) : x.name!.toLowerCase() === wanted),
      (x: T) => stat(x, (name) => name.includes(wanted)),
    ]
      .map((test) => pool.filter(test))
      .find((hits) => hits.length) ?? [];
  if (found.length === 1) return found[0];
  problems.push(
    found.length
      ? `"${given}" could be more than one thing. Give one of these ids instead: ${found.map((x) => `${x.id}${x.stats?.length ? ` (${statLines(x.stats, exactly(100), maxLevel).join(', ')})` : ''}`).join('; ')}.`
      : `"${given}" is not ${what}.${pool.length && pool.length <= LISTED ? ` The choices: ${pool.map(label).join(', ')}.` : ''}`,
  );
}

const place = <T extends Named>(pool: T[], list: Given[] = [], what: string, problems: string[]) =>
  list.flatMap((given) => {
    const found = pick(pool, idOf(given), what, problems);
    return found ? [{ found, roll: rollOf(given) }] : [];
  });
const rolled = (placed: { found: Named; roll?: number }[]): Rolled[] => placed.map(({ found, roll }) => ({ id: found.id, roll }));
const repeated = (things: Named[]) => [...new Set(things.filter((x, i) => things.indexOf(x) !== i).map(label))];
const once = (things: Named[], problems: string[]) => {
  if (repeated(things).length) problems.push(`Given more than once: ${repeated(things).join(', ')}.`);
};
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const wereGiven = (n: number) => `${n} ${n === 1 ? 'was' : 'were'} given`;

function givenItem(slot: (typeof GEAR_SLOTS)[number], given: GivenItem, level: number, problems: string[]): Item | undefined {
  const baseOf = (id: string) => gear.bases.find((b) => b.id === id)!;
  const fitting = gear.uniques.filter((u) => slot.fits(baseOf(u.base)));
  const unique = given.unique ? pick(fitting, given.unique, 'a unique that goes in this slot', problems) : undefined;
  if (given.unique && !unique) return;
  if (!unique && !given.base) problems.push('Needs a base or a unique.');
  const base = unique ? baseOf(unique.base) : given.base ? pick(gear.bases, given.base, 'base gear', problems) : undefined;
  if (!base) return;
  if (!slot.fits(base)) return void problems.push(`${base.name} doesn't go in this slot.`);
  const rarity = unique ? gear.uniqueRarity : given.rarity ? pick(gear.rarities, given.rarity, 'a gear rarity', problems) : top;
  if (!rarity) return;

  const rollable = gear.affixes.filter((a) => canRoll(a, base));
  const affixes = (type: 'prefix' | 'suffix') => {
    const fits = rollable.filter((a) => a.type === type);
    const placed = place(fits, given[type], `a ${type} that rolls on ${base.name}`, problems);
    const most = slotCount(rarity, type);
    if (placed.length > most) problems.push(`${rarity.name} gear has ${count(most, `${type} slot`)}, but ${wereGiven(placed.length)}.`);
    once(placed.filter((p) => !p.found.repeatable).map((p) => p.found), problems);
    return rolled(placed);
  };
  const implicits = rollable.filter((a) => a.type === 'implicit');
  const implicit = place(implicits, given.implicit ? [given.implicit] : [], `an implicit of ${base.name}`, problems);

  const kinds = gear.corruption.kinds.filter((k) => k.rarities.includes(rarity.id));
  const kind = given.corruption ? pick(kinds, given.corruption.kind, `a corruption of ${rarity.name} gear`, problems) : undefined;
  const corruptions = gear.corruption.affixes.filter((a) => canRoll(a, base));
  const corrupted = place(corruptions, given.corruption?.affixes, `a corruption affix that rolls on ${base.name}`, problems);
  if (kind && corrupted.length > kind.affixes) problems.push(`${kind.name} corruption adds ${count(kind.affixes, 'affix', 'affixes')}, but ${wereGiven(corrupted.length)}.`);
  once(corrupted.map((p) => p.found), problems);

  const socketed = (given.sockets ?? []).flatMap((entry) => {
    const only = typeof entry === 'string' ? undefined : entry.kind;
    const fits = (['gem', 'rune'] as const).flatMap((type) => (only && only !== type ? [] : (type === 'gem' ? gear.gems : gear.runes).map(({ id, name }) => ({ id, name, kind: type }))));
    const found = pick(fits, idOf(entry), 'a gem or a rune', problems);
    return found ? [{ kind: found.kind, found, roll: rollOf(entry) }] : [];
  });
  const of = (type: 'gem' | 'rune') => socketed.filter((s) => s.kind === type);
  const room = rarity.sockets + (kind?.sockets ?? 0);
  if (socketed.length > room) problems.push(`This ${rarity.name} item has ${count(room, 'socket')}, but ${socketed.length} were filled.`);
  if (of('gem').length > rarity.maxGems) problems.push(`${rarity.name} gear holds ${count(rarity.maxGems, 'gem')} at most.`);
  if (of('rune').length > rarity.maxRunes) problems.push(`${rarity.name} gear holds ${count(rarity.maxRunes, 'rune')} at most.`);
  if (repeated(of('rune').map((s) => s.found)).length) problems.push('A rune fits once per item.');

  const infusions = gear.infusions.filter((a) => canRoll(a, base));
  const infusion = given.infusion ? pick(infusions, idOf(given.infusion), `an infusion that rolls on ${base.name}`, problems) : undefined;
  const infusionRarity = typeof given.infusion === 'object' && given.infusion.rarity ? pick(tiers, given.infusion.rarity, 'an infusion rarity', problems) : top;

  const enchants = (given.enchants ?? []).flatMap((e) => {
    const found = pick(gear.enchants, e.id, 'an enchantment the pack gives stats for', problems);
    return found ? [{ found, level: e.level }] : [];
  });
  once(enchants.map((e) => e.found), problems);

  return {
    base: base.id,
    unique: unique?.id,
    rarity: rarity.id,
    level: given.level ?? level,
    baseRoll: given.baseRoll,
    quality: given.quality || undefined,
    implicit: rolled(implicit)[0],
    prefix: affixes('prefix'),
    suffix: affixes('suffix'),
    uniqueRolls: given.uniqueRolls,
    sockets: socketed.map(({ kind: type, found, roll }) => ({ kind: type, id: found.id, roll })),
    runewordRoll: given.runewordRoll,
    infusion: infusion && infusionRarity && { id: infusion.id, rarity: infusionRarity.id },
    corruption: kind && { kind: kind.id, affixes: rolled(corrupted) },
    enchants: enchants.map(({ found, level: at }) => ({ id: found.id, level: at })),
  };
}

function givenCodex(given: GivenCodex, level: number, problems: string[]): Codex | null {
  const kind = pick(gear.codex.kinds, given.id, 'a codex', problems);
  const rarity = given.rarity ? pick(tiers, given.rarity, 'a codex rarity', problems) : top;
  if (!kind || !rarity) return null;
  const limits = gear.codex.rarities[rarity.id];
  // Left out, a kind of piece is asked for as little as the rarity lets it be.
  const pieces = Object.fromEntries(
    RARITY_TYPES.map((type) => {
      const { min, max } = limits.pieces[type];
      const asked = given.pieces?.[type] ?? min;
      if (asked < min || asked > max) problems.push(`The number of ${type} pieces a ${rarity.name} codex asks for is ${min === max ? min : `${min} to ${max}`}, not ${asked}.`);
      return [type, asked];
    }),
  ) as Codex['pieces'];
  // Off-hand slots are never asked for (Omen.getRandomSlotReq).
  const asked = [...new Set(gear.bases.filter((b) => b.family !== 'OffHand').map((b) => b.slot))].map((id) => ({ id, name: gear.slotNames[id] }));
  const slots = (given.slots ?? []).flatMap(({ slot, type }) => {
    const found = pick(asked, slot, 'a kind of gear a codex can ask for', problems);
    return found ? [{ slot: found.id, type }] : [];
  });
  if (slots.length > limits.slots) problems.push(`A ${rarity.name} codex has ${count(limits.slots, 'slot condition')}, but ${wereGiven(slots.length)}.`);
  const pool = gear.codex.affixes.filter((a) => kind.affixTypes.includes(a.type));
  const affixes = place(pool, given.affixes, 'an affix of a codex', problems);
  if (affixes.length > limits.affixes) problems.push(`A ${rarity.name} codex has ${count(limits.affixes, 'affix', 'affixes')}, but ${wereGiven(affixes.length)}.`);
  once(affixes.map((a) => a.found), problems);
  return { id: kind.id, rarity: rarity.id, level: given.level ?? level, pieces, slots, affixes: affixes.map((a) => a.found.id) };
}

function givenJewel(given: NonNullable<GivenBuild['jewels']>[number], level: number, problems: string[]): Jewel | undefined {
  const { kinds, crafted, eye, affixes } = sockets.jewels;
  const kind = pick<Named>([...kinds, { id: 'crafted', name: crafted.name }, { id: 'eye', name: eye.name }], given.kind, 'a jewel', problems);
  const rarity = given.rarity && kinds.includes(kind as (typeof kinds)[number]) ? pick(sockets.rarities, given.rarity, 'a jewel rarity', problems) : sockets.rarities.at(-1)!;
  if (!kind || !rarity) return;
  const jewel: Jewel = { kind: kind.id as Jewel['kind'], rarity: rarity.id, level: given.level ?? level, affixes: [], corruption: [] };
  const about = describeJewel(sockets, jewel);
  const placed = place([...about.pool, ...about.own], given.affixes, `an affix of ${about.item.name}`, problems);
  for (const [pool, slots] of [
    [about.pool, about.slots],
    [about.own, about.ownSlots],
  ] as const) {
    const held = placed.filter((p) => pool.includes(p.found)).length;
    if (held > slots) problems.push(`${about.rarity?.name ?? 'This'} ${about.item.name} holds ${slots} of ${pool === about.own ? 'the affixes only it has' : 'the ordinary jewel affixes'}, but ${wereGiven(held)}.`);
  }
  const corrupted = place(affixes.corruption, given.corruption, 'a jewel corruption', problems);
  if (corrupted.length > 2) problems.push(`A jewel holds 2 corruption affixes, but ${wereGiven(corrupted.length)}.`);
  once([...placed, ...corrupted].map((p) => p.found), problems);
  return { ...jewel, affixes: rolled(placed), corruption: rolled(corrupted) };
}

const elementName = (id: string) => Object.values(ELEMENTS).find((element) => element.id === id)!.name;

// What a build comes to: its points, damage and defense as the build editor works them out, every
// stat when `stats` is set, and the file the editor imports when `file` is. Throws, saying what is
// wrong, for a build the game wouldn't allow.
export function characterBuild(origin: string, given: GivenBuild, options: { connect?: boolean; allStats?: boolean; file?: boolean } = {}): string {
  const problems: string[] = [];
  // Problems of one part of the build, noted under that part's name.
  const within = <T>(where: string, read: (issues: string[]) => T) => {
    const issues: string[] = [];
    const result = read(issues);
    problems.push(...issues.map((issue) => `${where}: ${issue}`));
    return result;
  };
  const level = given.level ?? maxLevel;
  const tally: string[] = [];
  const pool = (id: Pool, spent: number, name: string) => {
    const points = core.points[id];
    const bonus = given.bonus?.[id] ?? (points.perLevel ? 0 : points.maxBonus);
    if (bonus > points.maxBonus) problems.push(`${name}: at most ${points.maxBonus} bonus points.`);
    const total = pointsAt(points, level, bonus);
    if (spent > total) problems.push(`${name}: ${spent} are spent, but level ${level} with ${bonus} bonus points gives ${total}.`);
    tally.push(`${name}: ${spent} of ${total} spent`);
  };

  const trees = {} as Build['trees'];
  for (const key of TREE_IDS) {
    const { tree, name } = TREES[key];
    const wanted = new Set<number>();
    const unknown: string[] = [];
    for (const node of given.trees?.[key] ?? []) {
      const index = typeof node === 'number' ? node : Number(node.match(new RegExp(`^\\[?(?:${key}-)?(\\d+)\\]?$`))?.[1] ?? NaN);
      if (tree.nodes[index]) wanted.add(index);
      else unknown.push(`${node}`);
    }
    if (unknown.length) problems.push(`${name}: not nodes of this tree: ${unknown.join(', ')}.`);
    const plan = planTree(key, wanted, level, given.bonus?.[key], !!options.connect && wanted.size > 0);
    problems.push(...plan.problems.map((issue) => `${name}: ${issue}`));
    trees[key] = [...plan.taken];
    tally.push(`${name}: ${plan.taken.size} of ${plan.total} spent`, ...(plan.added.length ? [addedLine(key, plan.added, level)] : []));
  }

  const classes = [...new Set((given.classes ?? []).flatMap((c) => pick(skills.classes, c, 'a class', problems) ?? []))];
  if (classes.length > MAX_CLASSES) problems.push(`A character has ${MAX_CLASSES} classes at most.`);
  const known = classes.flatMap((c) => c.perks.map((perk) => ({ id: perk.id, name: perk.spell?.name, stats: perk.stats, perk })));
  const spells = known.filter((k) => k.perk.spell);
  const whose = classes.map((c) => c.name).join(' or ') || 'a class the build has';
  const perks: Record<string, number> = {};
  for (const [key, points] of Object.entries(given.perks ?? {})) {
    const found = points > 0 && pick(known, key, `a spell or passive of ${whose}`, problems);
    if (!found) continue;
    const most = maxRank(found.perk, level);
    if (points > most) problems.push(`${label(found)} ${most ? `takes ${most} points at most at level ${level}` : `opens at level ${found.perk.level}`}, but was given ${points}.`);
    perks[found.id] = points;
  }
  const spent = (spell: boolean) => known.filter((k) => !!k.perk.spell === spell).reduce((sum, k) => sum + (perks[k.id] ?? 0), 0);
  pool('spells', spent(true), 'Spell points');
  pool('passives', spent(false), 'Passive points');

  const hotbar = (given.hotbar ?? []).map((slot) => {
    const found = slot?.spell ? pick(spells, slot.spell, `a spell of ${whose}`, problems) : undefined;
    if (!found) return null;
    return within(found.name!, (issues) => {
      const points = perks[found.id] ?? 0;
      if (!points) issues.push('It is on the hotbar, but no points are in it.');
      const supports = place(skills.supports, slot!.supports, 'a support gem', issues);
      const open = supportSlots(points, level, core.linkLevels);
      if (supports.length > open) issues.push(`With ${points} points at level ${level} it has ${count(open, 'support slot')}, but ${wereGiven(supports.length)}.`);
      for (const { found: gem } of supports) if (gem.minLevel > level) issues.push(`${gem.name} needs level ${gem.minLevel}.`);
      once(supports.map((s) => s.found), issues);
      const kinds = Map.groupBy(supports.filter((s) => s.found.oneKind), (s) => s.found.oneKind);
      for (const [kind, gems] of kinds) if (gems.length > 1) issues.push(`Only one ${kind} support fits a skill.`);
      return { spell: found.id, supports: rolled(supports) };
    });
  });
  const slotted = hotbar.flatMap((slot) => spells.find((s) => s.id === slot?.spell) ?? []);
  if (repeated(slotted).length) problems.push(`On the hotbar more than once: ${repeated(slotted).join(', ')}.`);

  const attributes: Record<string, number> = {};
  for (const [key, points] of Object.entries(given.stats ?? {})) {
    const found = pick(core.attributes, key, 'an attribute', problems);
    if (found && points > 0) attributes[found.id] = points;
  }
  pool('stats', Object.values(attributes).reduce((sum, n) => sum + n, 0), 'Stat points');

  const worn = Object.fromEntries(
    GEAR_SLOTS.flatMap((slot) => {
      const item = given.gear?.[slot.id] && within(slot.name, (issues) => givenItem(slot, given.gear![slot.id]!, level, issues));
      return item ? [[slot.id, item]] : [];
    }),
  );
  const codex = given.codex ? within('Codex', (issues) => givenCodex(given.codex!, level, issues)) : null;

  const augments = place(sockets.auras, given.augments, 'an augment', problems);
  if (augments.length > AUGMENT_SLOTS) problems.push(`A character has ${AUGMENT_SLOTS} augment slots, but ${augments.length} augments were given.`);
  for (const { found } of augments) if (found.minLevel > level) problems.push(`${found.name} needs level ${found.minLevel}.`);
  once(augments.map((a) => a.found), problems);

  const jewels = (given.jewels ?? []).flatMap((jewel, i) => within(`Jewel ${i + 1}`, (issues) => givenJewel(jewel, level, issues)) ?? []);
  for (const kind of ['crafted', 'eye']) if (jewels.filter((j) => j.kind === kind).length > 1) problems.push(`Only one ${describeJewel(sockets, jewels.find((j) => j.kind === kind)!).item.name} can be socketed.`);

  const skill = given.damage?.skill ? pick(spells, given.damage.skill, `a spell of ${whose}`, problems) : undefined;

  const { retribution } = skills;
  if (given.retribution && !classes.some((c) => c.id === RETRIBUTION.class)) problems.push(`Only a Crusader holds ${retribution.name} stacks.`);
  if ((given.retribution ?? 0) > retribution.max) problems.push(`At most ${retribution.max} ${retribution.name} stacks can be held, but ${given.retribution} were given.`);

  const learned = spells.filter((s) => perks[s.id] > 0 && skills.auras.some((a) => a.id === s.id));
  const aura = given.aura ? pick(learned, given.aura, 'an aura the build has learned', problems) : undefined;
  const healers = spells.filter((s) => sections.damage.heals[s.id] && !sections.damage.skills[s.id]);
  const defensive = (given.defensive ?? []).flatMap((key) => pick(healers, key, `a skill of ${whose} that heals and deals no damage`, problems) ?? []);
  once(defensive, problems);

  const mob = given.enemy?.rarity ? pick(defense.mob.rarities, given.enemy.rarity, 'a mob rarity', problems) : defense.mob.rarities[0];
  // An empty one stands for an affix that changes nothing about the mob's hits or its defenses.
  const mobAffixes = (given.enemy?.affixes ?? []).map((affix) => (affix && pick(defense.mob.affixes, affix, "a mob affix that changes the mob's hits or its defenses", problems)?.id) || '');
  if (mob && mobAffixes.length > mob.affixes) problems.push(`A ${mob.name} mob has ${count(mob.affixes, 'affix', 'affixes')}, but ${wereGiven(mobAffixes.length)}.`);

  const made = (effects: Record<string, number>) =>
    readBuild(
      {
        ...given,
        trees,
        stats: attributes,
        classes: classes.map((c) => c.id),
        perks,
        hotbar,
        gear: worn,
        codex,
        augments: rolled(augments),
        jewels,
        damage: { ...given.damage, skill: skill?.id },
        enemy: { ...given.enemy, rarity: mob?.id, affixes: mobAffixes },
        aura: aura?.id,
        effects,
        defensive: defensive.map((d) => d.id),
      },
      core,
    )!;
  // What can be turned on follows the build's stats, and an effect that is on can give the stat
  // that gives another. So the effects are read against the build without any, and once more
  // with those found there on.
  const read = (draft: Build, issues: string[]) => {
    const can = buildTotals(sections, draft).effects;
    const offered = skills.effects.filter((effect) => can.some((held) => held.id === effect.id));
    return Object.entries(given.effects ?? {}).flatMap(([key, held]) => {
      const found = held > 0 && pick(offered, key, 'an effect the build can turn on', issues);
      return found ? [{ found, held }] : [];
    });
  };
  const turned = (list: ReturnType<typeof read>) => made(Object.fromEntries(list.map((e) => [e.found.id, e.held])));
  const effects = read(turned(read(made({}), [])), problems);
  once(effects.map((e) => e.found), problems);
  for (const [kind, alike] of Map.groupBy(effects.filter((e) => e.found.kind), (e) => e.found.kind)) {
    if (alike.length > 1) problems.push(`Only one ${kind} effect is on at a time, but ${alike.map((e) => e.found.name).join(' and ')} were given.`);
  }
  const build = turned(effects);

  const jewelRoom = jewelSockets(core, build);
  if (build.jewels.length > jewelRoom) problems.push(`The build has ${count(build.jewels.length, 'jewel')} but ${count(jewelRoom, 'jewel socket')}. Sockets come from talents and from a few uniques.`);
  const attack = buildDamage(sections, build);
  const totals = attack.own;
  const guard = buildDefense(sections, build, attack);
  problems.push(...totals.skipped);
  for (const { id, name, max } of totals.effects) if (build.effects[id] > max) problems.push(`${name} has ${count(max, 'stack')} at most, but ${build.effects[id]} were given.`);
  const reserved = augments.reduce((sum, { found }) => sum + augmentCost(totals.stats, found), 0);
  const capacity = augmentCapacity(totals.rules, totals.stats);
  if (reserved > capacity) problems.push(`The augments take ${reserved} augment capacity, but the build has ${capacity}.`);
  if (skill && !attack.chosen) {
    const choices = attack.choices.map((c) => c.spell.name);
    problems.push(`${skill.name} is not a skill on the hotbar whose damage can be worked out. ${choices.length ? `The choices: ${choices.join(', ')}.` : 'No skill on the hotbar is.'}`);
  }
  for (const d of defensive) if (!attack.defensive.offered.some((o) => o.id === d.id)) problems.push(`${d.name} can only be cast whenever it is ready from the hotbar, with points in it.`);
  if (problems.length) throw new Error(problems.join('\n'));

  const { defs } = totals.rules;
  const { chosen, damage: dealt, crit } = attack;
  const { value, avoid, rows, weakest, enemy } = guard;
  // A summon skill is used by its pets, one attack at a time.
  const casts = chosen && dealt.pets === undefined;
  const each = casts ? 'cast' : 'attack';
  const held = attack.retribution.stacks;
  const others = attack.choices.filter((c) => c !== chosen).map((c) => c.spell.name);
  // The effects on one side: those that are on, with their stacks, or all that can be. One that
  // is listed for both sides goes by an id of its own on the second.
  const effectNames = (enemy: boolean, on: boolean) =>
    totals.effects
      .filter((e) => e.enemy === enemy && (!on || e.stacks))
      .map((e) => (on ? (e.stacks > 1 ? `${e.stacks} ${e.name}` : e.name) : `${e.name}${e.id === e.effect ? '' : ` (given as ${e.id})`}${e.max > 1 ? ` (up to ${e.max} stacks)` : ''}`));
  const forms = chosen ? attack.rules.skills[chosen.perk.id].variants : [];
  // What each effect the skill leaves deals of a cast, by the effect's name.
  const left = Map.groupBy(dealt.parts.filter((part) => part.hit?.effect), (part) => part.hit!.effect!);
  const whole = (parts: typeof dealt.parts) => parts.reduce((all, part) => all + part.count * Object.values(part.damage).reduce((sum, n) => sum + n, 0), 0);
  // Stats that came to something but depend on the moment, which neither tab of the editor counts.
  const leftOut = (ids: string[]) => (ids.length ? [`Left out, because they depend on the moment: ${ids.map((id) => defs[id].name.replace('[VAL1]', 'X')).join(', ')}`] : []);
  const { shortest } = guard;
  const resource = (id: Resource) => `${defs[id].name}: ${amount(value(id))}${guard.held[id] > 0 ? `, ${amount(guard.held[id])} recovered a second while fighting` : ''}`;
  // What the skill costs and what comes back, for each resource it spends.
  const { cost, petCost, spent: paid, recovered, dry, kept } = attack.resources;
  const spending = (Object.keys(paid) as Resource[]).filter((id) => paid[id]! > 0);
  const { defensive: guards } = attack;
  const restored = (by: Partial<Record<Resource, number>>, times = 1) =>
    (Object.entries(by) as [Resource, number][])
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${amount(n * times)} ${defs[id].name.toLowerCase()}`)
      .join(' and ') || 'nothing';
  const casting = guards.used.map((d) => d.name).join(' and ');

  const gearLines = GEAR_SLOTS.flatMap((slot) => {
    const item = build.gear[slot.id];
    const parts = item && readItem(gear, item);
    const needs = parts ? needsAt(parts.base.needs, gear.requirement, item.level) : [];
    return parts
      ? [
          `${slot.name}: ${nameOf(parts)}, ${parts.rarity.name} ${parts.base.name}, level ${item.level}${parts.runeword ? `, forms the runeword ${parts.runeword.name}` : ''}${needs.length ? `, needs ${needs.map((n) => `${n.value} ${defs[n.stat].name}`).join(' and ')}` : ''}`,
        ]
      : [];
  });
  const book = readCodex(gear, build);
  if (book) {
    const kinds = RARITY_TYPES.map((type) => ({ type, asked: book.codex.pieces[type], worn: book.byKind[type] ?? 0 }));
    const steps = codexBonuses(book.codex, book.kind.mods, book.affixes).map((step) => `${step.pieces} for ${[...(step.affix ? [label(step.affix)] : []), ...(step.mods ? ['its own stats'] : [])].join(' and ')}${book.worn >= step.pieces ? ' (on)' : ''}`);
    gearLines.push(
      `Codex: ${book.rarity.name} ${book.kind.name}, level ${book.codex.level}. It asks for ${kinds.map((k) => `${k.asked} ${k.type}`).join(', ')} ${given.codex?.pieces ? '' : `(pieces was left out, so the fewest a ${book.rarity.name} codex can ask for) `}and counts ${kinds.map((k) => `${k.worn} ${k.type}`).join(', ')} worn: ${book.worn} in all. A worn item counts toward the kind of its rarity (a unique as unique, runeword gear as runed, every other rarity as normal), up to what is asked of that kind. Pieces it takes: ${steps.join('; ')}`,
    );
  }

  return [
    [`# ${build.name}`, `Level ${level}, ${classes.map((c) => c.name).join(' and ') || 'no class'}. Worked out for pack ${core.pack}.`],
    ['## Points', ...tally, `Augment capacity: ${reserved} of ${capacity} reserved`, `Jewel sockets: ${build.jewels.length} of ${jewelRoom} filled`],
    ...(gearLines.length ? [['## Gear', ...gearLines]] : []),
    [
      '## Damage',
      `Skill: ${chosen?.spell.name ?? 'Basic attack'}${attack.form?.needs.length ? `, used with ${attack.form.needs.join(' and ')}${attack.forced ? ', which it needs to do anything and is taken to have' : ''}` : ''}${attack.rank ? `, at level ${attack.rank.rank}${attack.rank.rank > attack.rank.learned ? ` (${attack.rank.learned} points and ${attack.rank.rank - attack.rank.learned} from stats that add skill levels)` : ''}` : ''}${attack.retribution.spends && held ? `, spending ${count(attack.retribution.spent, `${retribution.name} stack`)} every cast while any are held (taken to be gained back as fast, as from blocks)` : ''}`,
      ...(attack.targets.area ? [`Enemies hit: ${attack.targets.count}${attack.targets.count > 1 ? '. Hits on an area and from projectiles that go on through enemies land on each, and every number below is what they take together' : ''}`] : []),
      ...(attack.aura ? [`Aura on: ${attack.aura.name}${attack.aura.damage ? `, which deals ${amount(attack.aura.damage.dps)} of the damage a second on its own` : ''}`] : []),
      ...(effectNames(false, true).length ? [`Effects on: ${effectNames(false, true).join(', ')}`] : []),
      ...(effectNames(true, true).length ? [`Effects on the enemy: ${effectNames(true, true).join(', ')}`] : []),
      `Damage a second: ${amount(attack.dps)}`,
      ...(guards.pace < 1 ? [`Casting ${casting} whenever ready leaves ${chosen ? chosen.spell.name : 'basic attacks'} ${percent(guards.pace)} of its full pace, which every number here counts`] : []),
      ...spending.map(
        (id) =>
          `${defs[id].name}: ${amount(cost[id] ?? 0)} each ${chosen ? 'cast' : 'attack'}${petCost?.[id] ? ` and ${amount(petCost[id])} each pet attack` : ''}, ${amount(paid[id]!)} spent a second at full pace and ${amount(recovered[id])} recovered a second (regeneration, leech and restores on hit, up to the leech cap)`,
      ),
      ...(dry ? [`At full pace ${defs[dry.resource].name.toLowerCase()} runs out after ${amount(dry.after)} s; after that ${amount(kept)} damage a second can be kept up, the skill used as often as what comes back pays for${dry.resource === 'energy' && totals.shield ? '. Below 1 energy a raised shield blocks nothing' : ''}`] : []),
      ...(attack.lasting.length ? [`Of that, from effects that are on and deal damage themselves: ${attack.lasting.map((e) => `${e.name} ${amount(e.damage.dps)} a second`).join(', ')}`] : []),
      ...(attack.procs.length
        ? [`Of that, from spells set off by hits: ${attack.procs.map((p) => `${p.name} ${amount(p.damage.dps)} a second (${amount(p.damage.total)} a cast, ${+p.damage.rate.toFixed(2)} casts a second)`).join(', ')}`]
        : []),
      `Each ${each}: ${amount(dealt.total)}`,
      ...(volleysMissed(dealt.parts).length
        ? [`Of projectiles shot together, ${volleysMissed(dealt.parts).map(({ shot, hit }) => `${hit} of ${shot}`).join(' and ')} are taken to hit the enemy, an enemy as big as a zombie 5 blocks away`]
        : []),
      ...(left.size ? [`Of that, from the effects it leaves, over the time they last or until the next cast renews them: ${[...left].map(([name, parts]) => `${name} ${amount(whole(parts))}`).join(', ')}`] : []),
      `${casts ? 'Casts' : 'Attacks'} a second: ${+dealt.rate.toFixed(2)}`,
      ...(dealt.pets === undefined ? [] : [`Pets out: ${+dealt.pets.toFixed(2)}, all attacking the target without pause`]),
      `${defs.critical_hit.name}: ${+crit.toFixed(1)}%`,
      `${defs.critical_damage.name}: ${amount(attack.stats.get('critical_damage')?.value ?? defs.critical_damage.base)}%`,
      ...(dealt.lands < 1 ? [`Chance to hit: ${percent(dealt.lands)}, the enemy dodging the rest`] : []),
      ...(attack.elements.length ? [`By element: ${attack.elements.map(([element, n]) => `${ELEMENTS[element].name} ${amount(n)} a second (${Math.round((n / attack.dps) * 100)}%)`).join(', ')}`] : []),
      `Enemy: level ${enemy.level} ${enemy.rarity.name} mob${enemy.affixes.length ? ` (${enemy.affixes.map((a) => a.name).join(', ')})` : ''}, ${['armor', 'dodge', 'spell_dodge'].map((id) => `${amount(attack.enemy.stats.get(id)?.value ?? 0)} ${defs[id].name.toLowerCase()}`).join(', ')}, resistances ${RESISTS.map((id) => `${elementName(id)} ${resistance(attack.enemy.stats, id, 0)}%`).join(', ')}`,
      ...(forms.length > 1
        ? [
            `${chosen!.spell.name} takes a form of its own with each of: ${forms.map((v) => [...v.needs, ...(v.retribution ? [`${retribution.name} (spending ${v.retribution} a cast)`] : [])].join(' and ') || 'no effect').join(', ')}. The effects that are on${forms.some((v) => v.retribution) ? ` and the ${retribution.name} stacks held` : ''} pick it`,
          ]
        : []),
      ...(effectNames(false, false).length ? [`Effects the build can turn on: ${effectNames(false, false).join(', ')}`] : []),
      ...(effectNames(true, false).length ? [`Effects it can put on the enemy: ${effectNames(true, false).join(', ')}`] : []),
      ...(others.length ? [`Other skills on the hotbar that can be worked out: ${others.join(', ')}`] : []),
      ...(totals.weapon ? [] : ['No weapon is held, so basic attacks are unarmed and skills that build on weapon damage have little to build on.']),
      ...leftOut(attack.rules.situational.filter((id) => attack.stats.get(id)?.value || (attack.stats.get(id)?.more ?? 1) !== 1)),
    ],
    [
      '## Defense',
      `Effective health: ${amount(weakest.effectiveHealth)}, the lowest of the five below, against ${ELEMENTS[weakest.element].name.toLowerCase()} hits`,
      ...(['health', 'magic_shield', 'mana', 'energy', 'blood'] as const).filter((id) => id !== 'blood' || value(id) > 0).map(resource),
      `Attributes: ${core.attributes.map((stat) => `${stat.name} ${amount(Math.trunc(value(stat.id)))}`).join(', ')}`,
      `Armor: ${amount(value('armor'))}`,
      `Attacks dodged: ${percent(avoid.dodge)}, magic spells dodged: ${percent(avoid.spellDodge)}`,
      ...(totals.shield
        ? [`Hits blocked at ${enemy.rate} a second: ${percent(avoid.blocked)}. A block is ready again after ${avoid.recovery} s, is made ${percent(avoid.block)} of the time and stops ${percent(avoid.stops)} of the hit`]
        : value('block_chance') > 0
          ? ['Blocking needs a shield in the off hand, so the block chance does nothing.']
          : []),
      ...rows.map(
        ({ element, resisted, lands, effectiveHealth }) =>
          `${ELEMENTS[element].name} hits: ${element === 'Physical' ? `${percent(resisted.used / 100)} stopped by armor` : `${resistText(resisted)} resisted`}, ${amount(lands)} of ${amount(enemy.hit)} taken, effective health ${amount(effectiveHealth)}`,
      ),
      `Against ${ELEMENTS[shortest.element].name.toLowerCase()} hits, which take ${amount(shortest.perSecond)} a second after defenses, dodges and blocks, ${Number.isFinite(shortest.lasts) ? `it falls after ${amount(shortest.lasts)} s from full, with the health and magic shield recovered while fighting coming back${guard.aura?.cost ? ` and ${guard.aura.name} taking its share` : ''}` : 'it recovers at least as fast, so it never falls'}`,
      ...(guard.aura?.cost
        ? [`${guard.aura.name} deals its caster ${amount(guard.aura.cost)} a second after defenses, ${percent(guard.aura.cost / (value('health') + value('magic_shield')))} of health and magic shield, which effective health leaves out`]
        : []),
      ...guards.used.map((d) => `Cast whenever ready: ${d.name}, ${+d.rate.toFixed(3)} casts a second, healing ${restored(d.perUse)} a cast and ${restored(d.perUse, d.rate)} a second, which the recovery above counts`),
      ...(chosen && attack.rules.heals[chosen.perk.id] ? [`${chosen.spell.name} heals its user too, which the recovery above counts`] : []),
      ...(guards.offered.some((o) => !guards.used.some((d) => d.id === o.id))
        ? [`Skills on the hotbar that heal and can be set under defensive: ${guards.offered.filter((o) => !guards.used.some((d) => d.id === o.id)).map((o) => o.name).join(', ')}`]
        : []),
      ...(held ? [`${retribution.name} stacks held: ${held}, each giving ${statLines(retribution.stats, exactly(100), level).join(', ')}`] : []),
      `Enemy: level ${enemy.level} ${enemy.rarity.name} mob${enemy.affixes.length ? ` (${enemy.affixes.map((a) => a.name).join(', ')})` : ''}${effectNames(true, true).length ? ` under ${effectNames(true, true).join(', ')}` : ''}, a common mob's hit being ${amount(enemy.hit)} before defenses, ${enemy.rate} hits a second`,
      ...leftOut(guard.rules.situational.filter((id) => value(id))),
    ],
    ...(options.allStats
      ? statGroups(totals)
          .filter((group) => group.rows.length)
          .map((group) => [`## Stats: ${group.name}`, ...group.rows.map(show)])
      : []),
    ...(options.file ? [['## File', `Give the user the text below as a file whose name ends in .json. They open it at ${origin}/build, under Builds, then Import a file.`, JSON.stringify(JSON.parse(exportBuild(build, core.pack)))]] : []),
  ]
    .map((part) => part.join('\n'))
    .join('\n\n');
}

// Server-side only: everything the site lists, as plain text an AI can search. Used by functions/mcp.ts;
// the site's own search index (pages/search.json.ts) borrows the stat lines.
import { canRoll, formatRange, formatStat, rolled, type Affix, type Rarity, type StatMod } from './affix';
import { auras } from './auras';
import { baseGear, reqScaling } from './bases';
import { affixes, bases, infusions, maxLevel, rarities, tagNames } from './gear';
import { gems } from './gems';
import type { FamilyStats } from './items';
import { planAffixes, planBases, planRarities } from './planner';
import { encodePlan, formedRuneword, itemName, rollWindows, slotCount } from './plannerRules';
import { runed, runes, runewords, slotNames } from './runes';
import { stats } from './stats';
import { encodeBuild, neighbours, rooted } from './talentRules';
import { ascendancy, atlas, talents, type Perk, type TalentTree } from './talents';
import { sources, uniqueRarity, uniques } from './uniques';

export { maxLevel };
export const CATEGORIES = ['affixes', 'infusions', 'bases', 'uniques', 'runes', 'runewords', 'gems', 'augments', 'talents', 'stats'] as const;
export const RARITIES = rarities.map((r) => r.id);
export const PLAN_RARITIES = planRarities.map((r) => r.id);

interface Entry {
  category: (typeof CATEGORIES)[number];
  title: string;
  lines: string[];
}

export const show = (line: { value: string; label: string }) => `${line.value} ${line.label}`.trim();
export const statLines = (mods: StatMod[], rolls: Rarity, level: number) => mods.map((s) => show(formatStat(s, rolls, level)));

const rollsOn = (affix: Affix) => {
  const fits = bases.filter((b) => canRoll(affix, b));
  return `Rolls on: ${fits.length === bases.length ? 'all gear' : fits.map((b) => b.name).join(', ')}`;
};
const weight = (affix: Affix) => (affix.weight ? `Weight: ${affix.weight}` : 'Never rolls (weight 0)');

// Off-hand gear uses the armor stats.
const FAMILIES = [
  ['Weapon', 'On weapons'],
  ['Armor', 'On armor and off-hand'],
  ['Jewelry', 'On jewelry'],
] as const;
export const familyLines = (item: FamilyStats, rolls: Rarity, level: number) =>
  FAMILIES.filter(([id]) => item[id].length).map(([id, label]) => `${label}: ${statLines(item[id], rolls, level).join(', ')}`);

const drop = (item: { drops: boolean; dropLevel: number }) => (item.drops ? `Drops from monsters of level ${item.dropLevel} and up` : 'Not a random drop');

export const TREES = {
  talents: { name: 'Talents', path: '/talents', tree: talents, links: neighbours(talents) },
  ascendancy: { name: 'Ascendancy', path: '/talents/ascendancy', tree: ascendancy, links: neighbours(ascendancy) },
  atlas: { name: 'Atlas passives', path: '/talents/atlas', tree: atlas, links: neighbours(atlas) },
};
const NODE_ID = new RegExp(`^\\[?(${Object.keys(TREES).join('|')})-(\\d+)\\]?$`);

function nodeAt(id: string) {
  const [, key, index] = id.match(NODE_ID) ?? [];
  const found = TREES[key as keyof typeof TREES];
  return found?.tree.nodes[Number(index)] ? { key, found, index: Number(index) } : null;
}

export const perkStats = (perk: Perk, level: number) => perk.stats.map((s) => show(formatRange(s, rolled(s, 100, level), rolled(s, 100, level))));
const perkLines = (perk: Perk, level: number) => [
  ...(perk.type === 'MAJOR' ? ['Game changer'] : []),
  ...(perk.entry ? ['Entry point: can be the first talent taken'] : []),
  ...(perk.oneKind ? [`Only one ${perk.oneKind} talent can be taken`] : []),
  ...perkStats(perk, level),
];

export const rollsAt = (rarity: Rarity) => ({
  whole: { ...rarity, minPercent: 0, maxPercent: 100 },
  // GearInfusionData.getPercent: an infusion doesn't roll, it sits at the top of its rarity's range.
  top: { ...rarity, minPercent: rarity.maxPercent },
  base: rollWindows(planRarities.find((r) => r.id === rarity.id)!).base,
});

// Each list is worked out the way its page on the site does it.
function entries(level: number, rarity: Rarity): Entry[] {
  const { whole, top, base: baseRolls } = rollsAt(rarity);
  const requirement = reqScaling.base + reqScaling.perLevel * (level - 1);

  return [
    ...affixes.map((a): Entry => ({
      category: 'affixes',
      title: a.name,
      lines: [`Type: ${a.type}`, rollsOn(a), weight(a), ...statLines(a.stats, a.type === 'implicit' ? whole : rarity, level)],
    })),
    // Infusions have no names in game, so what they give stands in for one.
    ...infusions.map((a): Entry => ({ category: 'infusions', title: statLines(a.stats, top, level).join(', '), lines: [rollsOn(a), weight(a)] })),
    ...baseGear.map((b): Entry => ({
      category: 'bases',
      title: b.name,
      lines: [
        `Slot: ${slotNames[b.slot]} (${b.family})`,
        `Tags: ${b.tags.map((t) => tagNames[t]).join(', ')}`,
        ...(b.needs.length ? [`Requires: ${b.needs.map((n) => `${Math.floor(n.factor * requirement)} ${n.name}`).join(', ')}`] : []),
        ...statLines(b.stats, baseRolls, level),
      ],
    })),
    ...uniques.map((u): Entry => ({
      category: 'uniques',
      title: u.name,
      lines: [
        `Base: ${bases.find((b) => b.id === u.base)!.name}`,
        `Source: ${sources.find((s) => s.id === u.source)!.name}`,
        `Drops from level ${u.minLevel} and map tier ${u.minMapTier}`,
        ...statLines(u.stats, uniqueRarity, level),
      ],
    })),
    ...runes.map((r): Entry => ({ category: 'runes', title: r.name, lines: [drop(r), ...familyLines(r.stats, runed, level)] })),
    ...runewords.map((w): Entry => ({
      category: 'runewords',
      title: w.name,
      lines: [
        `Runes, in socket order: ${w.runes.map((id) => runes.find((r) => r.id === id)!.name).join(', ')}`,
        `Fits: ${w.slots.map((s) => slotNames[s]).join(', ')}`,
        ...statLines(w.stats, runed, level),
      ],
    })),
    // Gem values are fixed, so the rarity and level passed here change nothing.
    ...gems.map((g): Entry => ({ category: 'gems', title: g.name, lines: [drop(g), ...familyLines(g.stats, runed, 1)] })),
    ...auras.map((a): Entry => ({
      category: 'augments',
      title: a.name,
      lines: [`Style: ${a.style}`, `Needs level ${a.minLevel}`, `Reserves ${a.reserves} Augment Capacity`, ...statLines(a.stats, rarity, level)],
    })),
    ...Object.entries(TREES).flatMap(([key, { name, tree }]) =>
      tree.perks.map((p, i): Entry => ({
        category: 'talents',
        title: p.name || 'Unnamed talent',
        lines: [
          `Tree: ${name}`,
          `Nodes: ${tree.nodes.flatMap((n, node) => (n[2] === i ? [`[${key}-${node}]`] : [])).join(', ')}`,
          ...perkLines(p, level),
        ],
      })),
    ),
    ...stats.map((s): Entry => ({
      category: 'stats',
      title: s.name,
      lines: [...(s.desc ? [s.desc] : []), ...(s.sources.length ? [`Found on: ${s.sources.join(', ')}`] : [])],
    })),
  ];
}

export interface Search {
  query?: string;
  category?: Entry['category'];
  level?: number;
  rarity?: string;
  limit?: number;
  offset?: number;
}

export function search({ query = '', category, level = maxLevel, rarity: rarityId, limit = 20, offset = 0 }: Search): string {
  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const inTitle = (e: Entry) => e.title.toLowerCase().includes(q);

  const found = entries(level, rarity)
    .filter((e) => !category || e.category === category)
    .filter((e) => {
      const text = [e.category, e.title, ...e.lines].join('\n').toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => Number(inTitle(b)) - Number(inTitle(a)));
  const page = found.slice(offset, offset + limit);
  if (!page.length) return found.length ? `Only ${found.length} entries match; offset ${offset} is past the end.` : 'Nothing matches.';

  return [
    `Showing ${offset + 1}-${offset + page.length} of ${found.length} matching entries. Values are at level ${level}, ${rarity.name} rarity.`,
    ...page.map((e) => [`## ${e.title} (${e.category})`, ...e.lines].join('\n')),
  ].join('\n\n');
}

const brief = (key: string, tree: TalentTree, node: number, level: number) => {
  const perk = tree.perks[tree.nodes[node][2]];
  return `[${key}-${node}] ${perk.name || perkStats(perk, level).join(', ')}`;
};

// Nodes are numbered per tree, as in the talent planner's build links.
export function talentLinks(nodes: string[], level = maxLevel): string {
  return nodes
    .map((id) => {
      const at = nodeAt(id);
      if (!at) return `${id} is not a talent node.`;
      const { key, found, index } = at;
      const perk = found.tree.perks[found.tree.nodes[index][2]];
      const linked = found.links[index].map((n) => brief(key, found.tree, n, level));
      return [`## [${key}-${index}] ${perk.name || 'Unnamed talent'} (${found.name})`, ...perkLines(perk, level), `Links to: ${linked.join('; ')}`].join('\n');
    })
    .join('\n\n');
}

// The wanted nodes plus the nodes that join them to the entry nodes, one wanted node at a time: whichever
// is fewest steps from what is joined so far goes next, by a shortest route. That isn't always the fewest
// nodes overall, but it is close. A route never takes a one-of-a-kind talent that wasn't asked for, which
// keeps it off other entry points. Wanted nodes no route reaches are left in, unjoined.
function joinUp(tree: TalentTree, links: number[][], wanted: Set<number>, entries: number[]): Set<number> {
  const taken = new Set(entries);
  const left = new Set([...wanted].filter((n) => !taken.has(n)));
  while (left.size) {
    const from = new Map<number, number>();
    const queue = [...taken];
    let hit: number | undefined;
    for (const n of queue) {
      if (left.has(n)) {
        hit = n;
        break;
      }
      for (const next of links[n]) {
        if (taken.has(next) || from.has(next) || (!wanted.has(next) && tree.perks[tree.nodes[next][2]].oneKind)) continue;
        from.set(next, n);
        queue.push(next);
      }
    }
    if (hit === undefined) break;
    for (let n = hit; !taken.has(n); n = from.get(n)!) {
      taken.add(n);
      left.delete(n);
    }
  }
  return new Set([...taken, ...left]);
}

// A link to the talent planner with the build loaded. Throws, saying what is wrong, for a build the game wouldn't allow.
export function talentBuildLink(origin: string, ids: string[], level = maxLevel, bonus?: number, connect = false): string {
  const unknown = ids.filter((id) => !nodeAt(id));
  if (unknown.length) throw new Error(`Not talent nodes: ${unknown.join(', ')}.`);
  const at = ids.map((id) => nodeAt(id)!);
  const { key, found } = at[0];
  if (at.some((a) => a.key !== key)) throw new Error('A link holds one tree. Make a separate link for each tree.');
  const { tree, links, name, path } = found;
  const { points } = tree;
  const wanted = new Set(at.map((a) => a.index));
  const list = (nodes: number[]) => nodes.map((n) => `[${key}-${n}]`).join(', ');
  const problems: string[] = [];

  const looseIn = (build: Set<number>) => {
    const held = rooted(tree, links, build);
    return [...build].filter((n) => !held.has(n));
  };
  let taken = wanted;
  if (connect) {
    const isEntry = (n: number) => tree.perks[tree.nodes[n][2]].entry;
    const given = [...wanted].filter(isEntry);
    // With no entry point asked for, each one is tried and the one that joins the most with the fewest nodes is kept.
    const starts = given.length ? [given] : tree.nodes.flatMap((_, n) => (isEntry(n) ? [[n]] : []));
    const cost = (build: Set<number>) => looseIn(build).length * tree.nodes.length + build.size;
    taken = starts.map((entries) => joinUp(tree, links, wanted, entries)).reduce((best, build) => (cost(build) < cost(best) ? build : best));
  }
  const added = [...taken].filter((n) => !wanted.has(n));
  const loose = looseIn(taken);
  if (loose.length)
    problems.push(
      connect
        ? `No route joins these to the rest of the build: ${list(loose)}.`
        : `Not joined to an entry point through other talents in the build: ${list(loose)}. Add the nodes in between, or set connect to have them added.`,
    );

  const kinds = Map.groupBy([...taken].filter((n) => tree.perks[tree.nodes[n][2]].oneKind), (n) => tree.perks[tree.nodes[n][2]].oneKind);
  for (const [kind, nodes] of kinds) if (nodes.length > 1) problems.push(`Only one ${kind} talent can be taken, but the build has ${list(nodes)}.`);

  // The planner page starts from the same bonus: none, or all of them on a tree that gives no points per level.
  bonus ??= points.perLevel ? 0 : points.maxBonus;
  if (bonus > points.maxBonus) problems.push(`The ${name} tree allows at most ${points.maxBonus} bonus points.`);
  const total = Math.min(points.maxTotal, points.base + Math.trunc(level * points.perLevel) + bonus);
  if (taken.size > total) {
    const most = Math.min(points.maxTotal, points.base + Math.trunc(maxLevel * points.perLevel) + points.maxBonus);
    problems.push(`The build takes ${taken.size} talents${added.length ? `, ${added.length} of them added to join it up` : ''}, but ${points.perLevel ? `level ${level} with ` : ''}${bonus} bonus points gives ${total} points. This tree never gives more than ${most}.`);
  }
  if (problems.length) throw new Error(problems.join('\n'));

  return [
    `${origin}${path}#${encodeBuild({ level, bonus, nodes: [...taken] })}`,
    `${name} tree, ${taken.size} of ${total} points spent${points.perLevel ? ` at level ${level}` : ''}${points.perLevel && bonus ? `, ${bonus} of them bonus points` : ''}.`,
    ...(added.length
      ? [`Added to join the build up (${added.length}): ${added.map((n) => brief(key, tree, n, level) + (tree.perks[tree.nodes[n][2]].type === 'MAJOR' ? ' (game changer)' : '')).join('; ')}`]
      : []),
  ].join('\n');
}

export interface GearPlan {
  base: string;
  rarity?: string;
  level?: number;
  implicit?: string;
  prefixes?: string[];
  suffixes?: string[];
  sockets?: string[];
  infusion?: string;
  infusionRarity?: string;
}

// A link to the gear planner with the item loaded. Throws, saying what is wrong, for an item the game wouldn't allow.
export function gearPlanLink(origin: string, plan: GearPlan): string {
  const same = (a: string, b: string) => a.toLowerCase() === b.trim().toLowerCase();
  const base = planBases.find((b) => same(b.name, plan.base) || same(b.id, plan.base));
  if (!base) throw new Error(`"${plan.base}" is not base gear. Search the bases category for the names.`);
  const rarity = planRarities.find((r) => r.id === (plan.rarity ?? RARITIES.at(-1)))!;
  const level = plan.level ?? maxLevel;
  const windows = rollWindows(rarity);
  const problems: string[] = [];

  // By name as the search gives it, or by id where two affixes that fit the gear share a name.
  const affix = (name: string, type: 'implicit' | 'prefix' | 'suffix') => {
    const fits = planAffixes.filter((a) => a.type === type && canRoll(a, base));
    const byId = fits.filter((a) => same(a.id, name));
    const found = byId.length ? byId : fits.filter((a) => same(a.name, name));
    if (found.length === 1) return found;
    const rolls = type === 'implicit' ? windows.implicit : windows.affix;
    problems.push(
      found.length
        ? `More than one ${type} named "${name}" fits ${base.name}. Give one of these ids instead: ${found.map((a) => `${a.id} (${statLines(a.stats, rolls, level).join(', ')})`).join('; ')}.`
        : `"${name}" is not ${type === 'implicit' ? 'an' : 'a'} ${type} that rolls on ${base.name}.`,
    );
    return [];
  };
  const slots = (type: 'prefix' | 'suffix', names: string[] = []) => {
    const picked = names.flatMap((name) => affix(name, type));
    const most = slotCount(rarity, type);
    if (names.length > most) problems.push(`${rarity.name} gear has ${most} ${type} ${most === 1 ? 'slot' : 'slots'}, but ${names.length} were given.`);
    const twice = picked.filter((a, i) => !a.repeatable && picked.indexOf(a) !== i);
    if (twice.length) problems.push(`These can only be on an item once: ${twice.map((a) => a.name).join(', ')}.`);
    return picked;
  };
  const implicit = plan.implicit ? affix(plan.implicit, 'implicit')[0] : undefined;
  const prefixes = slots('prefix', plan.prefixes);
  const suffixes = slots('suffix', plan.suffixes);

  const socketed = (plan.sockets ?? []).flatMap((name) => {
    const gem = gems.find((g) => same(g.name, name) || same(g.id, name));
    const rune = runes.find((r) => same(r.name, name) || same(r.id, name));
    if (!gem && !rune) problems.push(`"${name}" is not a gem or a rune.`);
    return gem ? [{ kind: 'gem', item: gem }] : rune ? [{ kind: 'rune', item: rune }] : [];
  });
  const count = (kind: string) => socketed.filter((s) => s.kind === kind).length;
  const runeIds = socketed.filter((s) => s.kind === 'rune').map((s) => s.item.id);
  if (socketed.length > rarity.sockets) problems.push(`${rarity.name} gear has ${rarity.sockets} sockets, but ${socketed.length} were filled.`);
  if (count('gem') > rarity.maxGems) problems.push(`${rarity.name} gear holds ${rarity.maxGems} gems at most.`);
  if (count('rune') > rarity.maxRunes) problems.push(`${rarity.name} gear holds ${rarity.maxRunes} runes at most.`);
  if (new Set(runeIds).size < runeIds.length) problems.push('A rune fits once per item.');
  const runeword = rarity.runewords ? formedRuneword(runewords, runeIds, base.slot) : undefined;

  // An infusion has no name, so it goes by a stat it gives.
  const infusionRarity = rarities.find((r) => r.id === plan.infusionRarity) ?? rarities.at(-1)!;
  const fitting = infusions.filter((a) => canRoll(a, base));
  const wanted = plan.infusion?.trim().toLowerCase();
  const matching = wanted ? fitting.filter((a) => same(a.id, wanted) || a.stats.some((s) => s.name.toLowerCase().includes(wanted))) : [];
  if (wanted && matching.length !== 1) {
    const choices = (matching.length ? matching : fitting).map((a) => a.stats.map((s) => s.name).join(' and ')).join('; ');
    problems.push(`${matching.length ? 'More than one infusion' : 'No infusion'} on ${base.name} gives "${plan.infusion}". ${choices ? `The choices: ${choices}.` : `${base.name} takes no infusion.`}`);
  }
  const infusion = matching.length === 1 ? matching[0] : undefined;
  if (problems.length) throw new Error(problems.join('\n'));

  const link = encodePlan({
    base: base.id,
    rarity: rarity.id,
    level,
    implicit: implicit?.id,
    prefix: prefixes.map((a) => a.id),
    suffix: suffixes.map((a) => a.id),
    sockets: socketed.map((s) => `${s.kind}:${s.item.id}`),
    infusion: infusion?.id,
    infusionRarity: infusionRarity.id,
  });
  const named = (list: typeof prefixes) => list.map((a) => `${a.name} (${statLines(a.stats, windows.affix, level).join(', ')})`).join('; ');
  return [
    `${origin}/planner#${link}`,
    `${itemName(base, implicit, prefixes[0], suffixes[0])}: ${rarity.name} ${base.name}, level ${level}.`,
    ...(implicit ? [`Implicit: ${statLines(implicit.stats, windows.implicit, level).join(', ')}`] : []),
    ...(prefixes.length ? [`Prefixes: ${named(prefixes)}`] : []),
    ...(suffixes.length ? [`Suffixes: ${named(suffixes)}`] : []),
    ...(socketed.length ? [`Sockets: ${socketed.map((s) => s.item.name).join(', ')}`] : []),
    ...(runeword ? [`Forms the runeword ${runeword.name}: ${statLines(runeword.stats, runed, level).join(', ')}`] : []),
    ...(infusion ? [`${infusionRarity.name} infusion: ${statLines(infusion.stats, rollsAt(infusionRarity).top, level).join(', ')}`] : []),
  ].join('\n');
}

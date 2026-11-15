// Server-side only: everything the site lists, as plain text an AI can search. Used by functions/mcp.ts.
import { canRoll, formatRange, formatStat, rolled, type Affix, type Rarity, type StatMod } from './affix';
import { auras } from './auras';
import { baseGear, reqScaling } from './bases';
import { affixes, bases, infusions, maxLevel, rarities, tagNames } from './gear';
import { gems } from './gems';
import type { FamilyStats } from './items';
import { planRarities } from './planner';
import { rollWindows } from './plannerRules';
import { runed, runes, runewords, slotNames } from './runes';
import { stats } from './stats';
import { neighbours } from './talentRules';
import { ascendancy, atlas, talents, type Perk } from './talents';
import { sources, uniqueRarity, uniques } from './uniques';

export { maxLevel };
export const CATEGORIES = ['affixes', 'infusions', 'bases', 'uniques', 'runes', 'runewords', 'gems', 'augments', 'talents', 'stats'] as const;
export const RARITIES = rarities.map((r) => r.id);

interface Entry {
  category: (typeof CATEGORIES)[number];
  title: string;
  lines: string[];
}

const show = (line: { value: string; label: string }) => `${line.value} ${line.label}`.trim();
const statLines = (mods: StatMod[], rolls: Rarity, level: number) => mods.map((s) => show(formatStat(s, rolls, level)));

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
const familyLines = (item: FamilyStats, rolls: Rarity, level: number) =>
  FAMILIES.filter(([id]) => item[id].length).map(([id, label]) => `${label}: ${statLines(item[id], rolls, level).join(', ')}`);

const drop = (item: { drops: boolean; dropLevel: number }) => (item.drops ? `Drops from monsters of level ${item.dropLevel} and up` : 'Not a random drop');

const TREES = {
  talents: { name: 'Talents', tree: talents, links: neighbours(talents) },
  ascendancy: { name: 'Ascendancy', tree: ascendancy, links: neighbours(ascendancy) },
  atlas: { name: 'Atlas passives', tree: atlas, links: neighbours(atlas) },
};

const perkStats = (perk: Perk, level: number) => perk.stats.map((s) => show(formatRange(s, rolled(s, 100, level), rolled(s, 100, level))));
const perkLines = (perk: Perk, level: number) => [
  ...(perk.type === 'MAJOR' ? ['Game changer'] : []),
  ...(perk.entry ? ['Entry point: can be the first talent taken'] : []),
  ...(perk.oneKind ? [`Only one ${perk.oneKind} talent can be taken`] : []),
  ...perkStats(perk, level),
];

// Each list is worked out the way its page on the site does it.
function entries(level: number, rarity: Rarity): Entry[] {
  const whole = { ...rarity, minPercent: 0, maxPercent: 100 };
  // GearInfusionData.getPercent: an infusion doesn't roll, it sits at the top of its rarity's range.
  const top = { ...rarity, minPercent: rarity.maxPercent };
  const baseRolls = rollWindows(planRarities.find((r) => r.id === rarity.id)!).base;
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

// Nodes are numbered per tree, as in the talent planner's build links.
export function talentLinks(nodes: string[], level = maxLevel): string {
  return nodes
    .map((id) => {
      const [, key, index] = id.match(/^\[?([a-z]+)-(\d+)\]?$/) ?? [];
      const found = TREES[key as keyof typeof TREES];
      const node = found?.tree.nodes[Number(index)];
      if (!node) return `${id} is not a talent node.`;
      const perkAt = (n: number) => found.tree.perks[found.tree.nodes[n][2]];
      const perk = perkAt(Number(index));
      const linked = found.links[Number(index)].map((n) => `[${key}-${n}] ${perkAt(n).name || perkStats(perkAt(n), level).join(', ')}`);
      return [`## [${key}-${Number(index)}] ${perk.name || 'Unnamed talent'} (${found.name})`, ...perkLines(perk, level), `Links to: ${linked.join('; ')}`].join('\n');
    })
    .join('\n\n');
}

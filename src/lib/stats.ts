// Build-time only: every named stat, its description and which of the site's lists it appears in.
import affixData from '../data/affixes.json';
import auraData from '../data/aura.json';
import baseData from '../data/base_gear_types.json';
import gemData from '../data/gems.json';
import langData from '../data/lang.json';
import runeData from '../data/runes.json';
import runewordData from '../data/runeword.json';
import supportData from '../data/support_gem.json';
import uniqueData from '../data/unique_gears.json';
import { text } from './gear';
import { spells } from './spells';
import { ascendancy, atlas, talents } from './talents';
import { uniques } from './uniques';

export interface Stat {
  name: string;
  desc: string;
  sources: string[];
}

type Mods = { stat: string }[];
const socketed = (item: { on_weapons_stats: Mods; on_armor_stats: Mods; on_jewelry_stats: Mods }) => [
  ...item.on_weapons_stats,
  ...item.on_armor_stats,
  ...item.on_jewelry_stats,
];
const shownUniques = new Set(uniques.map((u) => u.id));

// In the order the site's nav lists them.
const SOURCES: [name: string, mods: Mods][] = [
  ['Affixes', Object.values(affixData).filter((a) => ['prefix', 'suffix', 'implicit'].includes(a.type)).flatMap((a) => a.stats)],
  ['Base gear', Object.values(baseData).flatMap((b) => b.base_stats)],
  ['Uniques', Object.values(uniqueData).filter((u) => shownUniques.has(u.guid)).flatMap((u) => u.unique_stats)],
  ['Runes', Object.values(runeData).flatMap(socketed)],
  ['Runewords', Object.values(runewordData).flatMap((r) => r.stats)],
  ['Gems', Object.values(gemData).flatMap(socketed)],
  ['Augments', Object.values(auraData).flatMap((a) => a.stats)],
  ['Support gems', Object.values(supportData).filter((g) => g.weight > 0).flatMap((g) => g.stats)],
  ['Infusions', Object.values(affixData).filter((a) => a.type === 'enchant' && a.weight > 0).flatMap((a) => a.stats)],
  ['Jewels', Object.values(affixData).filter((a) => ['jewel', 'jewel_corruption', 'crafted_jewel_unique', 'watcher_eye'].includes(a.type)).flatMap((a) => a.stats)],
  ['Talents', [talents, ascendancy, atlas].flatMap((tree) => tree.perks).flatMap((p) => p.stats.map((s) => ({ stat: s.id })))],
  ['Spells', spells.flatMap((spell) => spell.stats.map((s) => ({ stat: s.id })))],
];
export const sourceNames = SOURCES.map(([name]) => name);
const sourceStats = SOURCES.map(([name, mods]) => [name, new Set(mods.map((m) => m.stat))] as const);

// Several stat ids share one name and description (one per profession, for example); those become one row.
const rows = new Map<string, Stat>();
for (const key of Object.keys(langData)) {
  const id = key.match(/^mmorpg\.stat\.([^.]+)$/)?.[1];
  if (!id) continue;
  // Sentence-style names carry a [VAL1] placeholder where the number goes.
  const name = text(key, id).replace('[VAL1]', 'X');
  const desc = text(`mmorpg.stat_desc.${id}`, '');
  const row = rows.get(`${name}\n${desc}`) ?? { name, desc, sources: [] };
  for (const [source, ids] of sourceStats) if (ids.has(id) && !row.sources.includes(source)) row.sources.push(source);
  rows.set(`${name}\n${desc}`, row);
}

// Some names open with a percent sign or an icon; sorting by the first letter keeps them in place.
const sortKey = (name: string) => name.replace(/^[^a-z0-9]+/i, '');

export const stats: Stat[] = [...rows.values()]
  .map((s) => ({ ...s, sources: sourceNames.filter((n) => s.sources.includes(n)) }))
  .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));

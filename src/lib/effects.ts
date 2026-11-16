// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import { existsSync } from 'node:fs';
import sourceData from '../data/effect_sources.json';
import effectData from '../data/exile_effect.json';
import type { StatMod } from './affix';
import { statMod, text } from './gear';
import { spells } from './spells';

// Something on another page; a shrine has no page of its own, so it has no address.
export interface Link {
  name: string;
  href?: string;
}

export interface Effect {
  id: string;
  name: string;
  // Empty for the few effects the pack has no texture for.
  icon: string;
  type: string;
  stats: StatMod[];
  // What it does to vanilla attributes, worded like a stat line.
  vanilla: { value: string; label: string; desc: string }[];
  desc: string;
  maxStacks: number;
  tags: string[];
  // Getting one removes any other effect of the same kind; empty for most.
  oneKind: string;
  // What gives it, out of what the site lists: spells, other effects, stats and shrines.
  from: Link[];
  // False when nothing in the pack gives it.
  applied: boolean;
}

// VanillaStatData.applyVanillaStats in Mine and Slash: a MORE modifier stops at -100%.
function vanillaLine(mod: { id: string; val: number }) {
  const percent = Math.max(mod.val, -1) * 100;
  const attribute = mod.id.split('.')[1].replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { value: `${Math.abs(percent)}%`, label: `${percent < 0 ? 'less' : 'more'} ${attribute}`, desc: '' };
}

// The pack marks each ailment with an effect named after it, and only the ailment has a description.
// [calc:x] stands for a number the game works out from the spell that applied the effect.
const desc = (id: string) =>
  (text(`mmorpg.effect.desc.${id}`, '') || text(`mmorpg.ailment.desc.${id.replace(/_effect$/, '')}`, '')).replace(/\[calc:\w+\] /g, '');

type Sources = Record<'spells' | 'effects' | 'shrines' | 'stats', string[]>;
const sources = sourceData as Record<string, Sources>;
const NONE: Sources = { spells: [], effects: [], shrines: [], stats: [] };

// An effect that only another effect gives is applied when that one is.
const applied = new Set(Object.keys(sources).filter((id) => ['spells', 'shrines', 'stats'].some((kind) => sources[id][kind as keyof Sources].length)));
for (let before = -1; before !== applied.size; ) {
  before = applied.size;
  for (const [id, { effects }] of Object.entries(sources)) if (effects.some((other) => applied.has(other))) applied.add(id);
}

// hide_from_wiki marks the golem buffs, which the in-game wiki skips too.
const shown = Object.values(effectData).filter((e) => !('hide_from_wiki' in e));
// Mercenaries have their own copies of some effects, which the pack gives the same names.
const name = (id: string) => text(`mmorpg.effect.${id}`, id) + (id.startsWith('merc_') ? ' (Mercenary)' : '');
const link = (page: string, name: string): Link => ({ name, href: `/${page}?q=${encodeURIComponent(name)}` });
// A few effects share a name, and one link finds them all.
const effectLinks = (ids: string[]) => [...new Set(ids.filter((id) => shown.some((e) => e.id === id)).map(name))].map((effect) => link('effects', effect));

function from({ spells: spellIds, effects, shrines, stats }: Sources): Link[] {
  // A spell that mobs, mercenaries or gear cast isn't on the spells page, so it has nothing to link to.
  const taught = spells.filter((s) => spellIds.includes(s.id)).map((s) => link('spells', s.name));
  // Stats that share a name are one row on the stats page.
  const statNames = [...new Set(stats.map((id) => text(`mmorpg.stat.${id}`, id).replace('[VAL1]', 'X')))];
  return [...taught, ...effectLinks(effects), ...statNames.map((stat) => link('stats', stat)), ...(shrines.length ? [{ name: 'Shrine' }] : [])];
}

// The effects each spell gives, by spell id.
export const spellEffects: Record<string, Link[]> = Object.fromEntries(
  spells.map((s) => [s.id, effectLinks(Object.keys(sources).filter((id) => sources[id].spells.includes(s.id)))] as const).filter(([, links]) => links.length),
);

export const effects: Effect[] = shown
  .map((e) => ({
    id: e.id,
    name: name(e.id),
    // scripts/extract.ts writes an icon for every effect that has a texture.
    icon: existsSync(`public/effects/${e.id}.webp`) ? `/effects/${e.id}.webp` : '',
    type: e.type,
    stats: e.stats.map(statMod),
    vanilla: e.mc_stats.map(vanillaLine),
    desc: desc(e.id),
    maxStacks: e.max_stacks,
    tags: e.tags.tags.map((tag) => text(`mmorpg.tag.effect.${tag}`, tag)),
    oneKind: e.one_of_a_kind_id.replaceAll('_', ' '),
    from: from(sources[e.id] ?? NONE),
    applied: applied.has(e.id),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const effectTags = [...new Set(effects.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b));

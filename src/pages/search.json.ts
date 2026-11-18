import type { APIRoute } from 'astro';
import { formatRange, rolled, type Rarity, type StatMod } from '../lib/affix';
import { auras } from '../lib/auras';
import { baseGear } from '../lib/bases';
import { codexAffixes, codexIcon, codexKinds, codexRarities } from '../lib/codexes';
import { effects } from '../lib/effects';
import { affixes, infusions, maxLevel, rarities } from '../lib/gear';
import { gems, ranks } from '../lib/gems';
import { abyssalEye, craftedJewel, jewelAffixes, jewelKinds } from '../lib/jewels';
import { familyLines, perkStats, rollsAt, show, statLines, TREES } from '../lib/mcp';
import { runed, runes, runewords } from '../lib/runes';
import type { Group, Row } from '../lib/siteSearch';
import { calcText, spellStat } from '../lib/spellRules';
import { bonusLevels, spells } from '../lib/spells';
import { stats } from '../lib/stats';
import { supports } from '../lib/supports';
import { uniqueRarity, uniques } from '../lib/uniques';

// The index behind the site's search box, fetched the first time the box is opened. Values are at
// the level and rarity every page starts on: the highest of each.
const rarity = rarities.at(-1)!;
const { whole, top, base } = rollsAt(rarity);
const lines = (mods: StatMod[], rolls: Rarity = rarity) => statLines(mods, rolls, maxLevel);

// An entry without a name is found on its page by its first stat, in the part of the stat's wording
// that stays the same at every level and rarity.
const find = (mods: StatMod[]) => mods[0].name.split('[VAL1]').sort((a, b) => b.length - a.length)[0].replace(/^%/, '').trim();
const unnamed = (mods: StatMod[], shown: string[], icon: Row[2] = null, note: string[] = []): Row => [shown.join(', '), note, icon, find(mods)];

const groups: Group[] = [
  { name: 'Affixes', href: '/affixes', rows: affixes.map((a) => [a.name, lines(a.stats, a.type === 'implicit' ? whole : rarity)]) },
  { name: 'Base gear', href: '/bases', plain: true, rows: baseGear.map((b) => [b.name, lines(b.stats, base)]) },
  { name: 'Uniques', href: '/uniques', rows: uniques.map((u) => [u.name, lines(u.stats, uniqueRarity)]) },
  { name: 'Runes', href: '/runes', rows: runes.map((r) => [r.name, familyLines(r.stats, runed, maxLevel), r.icon]) },
  { name: 'Runewords', href: '/runes', rows: runewords.map((w) => [w.name, lines(w.stats, runed)]) },
  {
    name: 'Gems',
    href: '/gems',
    // The gems page lists one rank at a time, so a gem is found there by its type.
    rows: gems.map((g) => [g.name, familyLines(g.stats, runed, 1), g.icon, g.name.replace(ranks[g.tier].name, '').trim()]),
  },
  { name: 'Augments', href: '/auras', rows: auras.map((a) => [a.name, lines(a.stats), a.icon]) },
  { name: 'Support gems', href: '/supports', rows: supports.map((s) => [s.name, lines(s.stats), s.icon]) },
  { name: 'Infusions', href: '/infusions', rows: infusions.map((a) => unnamed(a.stats, lines(a.stats, top))) },
  {
    name: 'Jewel affixes',
    href: '/jewels',
    rows: [
      ...jewelAffixes.jewel.map((a) => unnamed(a.stats, lines(a.stats), jewelKinds.find((k) => a.tags.includes(k.tag))?.icon)),
      ...jewelAffixes.corruption.map((a) => unnamed(a.stats, lines(a.stats), null, ['Corruption'])),
      ...jewelAffixes.crafted.map((a) => unnamed(a.stats, lines(a.stats), craftedJewel.icon, [craftedJewel.name])),
      ...jewelAffixes.eye.map((a) => unnamed(a.stats, lines(a.stats, whole), abyssalEye.icon, [`${abyssalEye.name}, under ${a.aura}`])),
    ],
  },
  {
    name: 'Codexes',
    href: '/codexes',
    // As the codex page starts out: a mythic codex asking for the most it can.
    rows: (() => {
      const { percent } = codexRarities.at(-1)!;
      const at = (mods: StatMod[]) => mods.map((m) => show(formatRange(m, rolled(m, percent.min, maxLevel), rolled(m, percent.max, maxLevel))));
      return [...codexKinds.map((k): Row => [k.name, at(k.mods), codexIcon]), ...codexAffixes.map((a) => unnamed(a.stats, at(a.stats), codexIcon, ['Codex affix']))];
    })(),
  },
  ...Object.values(TREES).map(({ name, path, tree }) => ({
    name,
    href: path,
    rows: tree.perks.map((p): Row => (p.name ? [p.name, perkStats(p, maxLevel), p.icon] : unnamed(p.stats, perkStats(p, maxLevel), p.icon))),
  })),
  {
    name: 'Spells',
    href: '/spells',
    // As the spells page starts out: every point spent on the spell, no bonus levels from gear.
    rows: spells.map((s) => {
      const topRank = s.maxLevel + bonusLevels;
      const fill = (desc: string) => desc.replace(/\[calc:(\w+)\]/g, (_, id) => calcText(s.calcs[id], s.maxLevel, topRank, maxLevel));
      return [
        s.name,
        [fill(s.desc), ...(s.linked ? [`${s.linked.name}: ${fill(s.linked.desc)}`] : []), ...s.stats.map((m) => show(spellStat(m, s.maxLevel, topRank, maxLevel))), s.tags.join(', ')].filter(Boolean),
        s.icon,
      ];
    }),
  },
  {
    name: 'Status effects',
    href: '/effects',
    rows: effects.map((e) => [
      e.name,
      [...[...e.stats.map((m) => formatRange(m, rolled(m, 0, maxLevel), rolled(m, 100, maxLevel))), ...e.vanilla].map(show), e.desc, e.tags.join(', ')].filter(Boolean),
      e.icon || null,
    ]),
  },
  { name: 'Stats', href: '/stats', rows: stats.map((s) => [s.name, s.desc ? [s.desc] : []]) },
];

export const GET: APIRoute = () => Response.json(groups);

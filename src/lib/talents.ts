// Build-time only, like gear.ts. Components may import the types from here, but only with `import type`.
import balanceData from '../data/game_balance.json';
import perkData from '../data/perk.json';
import iconData from '../data/talent_icons.json';
import treeData from '../data/talent_tree.json';
import type { StatMod } from './affix';
import { statMod, text } from './gear';

export interface Perk {
  type: 'STAT' | 'SPECIAL' | 'MAJOR' | 'START' | 'ASC';
  // Which cell of public/talents/icons.png holds the icon.
  icon: number;
  // Empty for the many small perks the game leaves unnamed.
  name: string;
  stats: StatMod[];
  // Set when the perk belongs to a group the game only lets you take one of.
  oneKind: string;
  // A character's first talent has to be an entry perk; every other one has to link to a taken perk.
  entry: boolean;
}

export interface TalentTree {
  // How many points a character has to spend: PlayerPointsType.getFreePoints in Mine and Slash.
  points: { base: number; perLevel: number; maxBonus: number; maxTotal: number };
  perks: Perk[];
  // Grid cells counted from the tree's centre, and an index into perks.
  nodes: [x: number, y: number, perk: number][];
  // Pairs of indexes into nodes.
  edges: [a: number, b: number][];
}

interface RawPerk {
  type: Perk['type'];
  icon: string;
  one_kind?: string;
  is_entry: boolean;
  stats: { stat: string; type: string; v1: number; scale_to_lvl: boolean }[];
}
const rawPerks = perkData as Record<string, RawPerk>;
const icons = iconData as Record<string, number>;

const MAX_DISTANCE = 12;
const AROUND = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [dx, dy])).filter(([dx, dy]) => dx || dy);

// The grid and the linking rules mirror GridPoint and TalentGrid in Mine and Slash. A cell with a
// one-letter id is a connector and a longer id is a perk. Two perks are linked when connectors of
// one single letter lead from one to the other without passing through a third perk.
function build(source: { perks: string; school_type: string }): TalentTree {
  const cells = source.perks.split('\n').map((row) => row.split(',').map((id) => id.toLowerCase()));
  const at = (x: number, y: number) => cells[y]?.[x] ?? '';
  // The centre marker counts as a perk here too: paths stop at it, though it is never drawn.
  const isPerk = (x: number, y: number) => at(x, y).length > 2;

  const points = cells.flatMap((row, y) => row.flatMap((id, x) => (id in rawPerks ? [{ x, y, id }] : [])));
  const pointAt = new Map(points.map((p, i) => [`${p.x},${p.y}`, i]));
  const centreY = cells.findIndex((row) => row.includes('[center]'));
  const centreX = cells[centreY].indexOf('[center]');

  const links = new Set<string>();
  points.forEach((from, a) => {
    const letters = new Set(AROUND.map(([dx, dy]) => at(from.x + dx, from.y + dy)).filter((id) => id.length === 1));
    for (const letter of letters) {
      const seen = new Set<string>();
      const queue = [[from.x, from.y]];
      for (const [x, y] of queue) {
        if (seen.has(`${x},${y}`)) continue;
        seen.add(`${x},${y}`);
        if (isPerk(x, y) && (x !== from.x || y !== from.y)) {
          const b = pointAt.get(`${x},${y}`);
          const near = Math.abs(x - from.x) < MAX_DISTANCE && Math.abs(y - from.y) < MAX_DISTANCE;
          if (b !== undefined && near) links.add(`${Math.min(a, b)},${Math.max(a, b)}`);
          continue;
        }
        for (const [dx, dy] of AROUND) {
          // A diagonal step can't cut past the corner of a perk.
          if (dx && dy && (isPerk(x + dx, y) || isPerk(x, y + dy))) continue;
          const id = at(x + dx, y + dy);
          if (id.length > 2 || id === letter) queue.push([x + dx, y + dy]);
        }
      }
    }
  });

  const perkIds = [...new Set(points.map((p) => p.id))];
  const budget = (balanceData.original_balance.player_points as Record<string, (typeof balanceData.original_balance.player_points)['TALENTS']>)[source.school_type];

  return {
    points: { base: budget.base_points, perLevel: budget.points_per_lvl, maxBonus: budget.max_bonus_points, maxTotal: budget.max_total_points },
    perks: perkIds.map((id) => {
      const perk = rawPerks[id];
      return {
        type: perk.type,
        icon: icons[perk.icon],
        name: text(`mmorpg.talent.${id}`, ''),
        stats: perk.stats.map((s) => {
          const mod = statMod({ stat: s.stat, type: s.type, min: s.v1, max: s.v1 });
          // Unlike gear, a perk's flat stats only grow with level when the perk asks for it. The
          // tree page has nowhere to show stat descriptions, so they are left out of it.
          return { ...mod, desc: '', scaling: s.scale_to_lvl ? mod.scaling : null };
        }),
        oneKind: perk.one_kind ? text(`mmorpg.one_of_a_kind.${perk.one_kind}`, perk.one_kind) : '',
        entry: perk.is_entry,
      };
    }),
    nodes: points.map((p) => [p.x - centreX, p.y - centreY, perkIds.indexOf(p.id)]),
    edges: [...links].map((link) => link.split(',').map(Number) as [number, number]),
  };
}

export const talents = build(treeData.talents);
export const ascendancy = build(treeData.ascendancy);
export const atlas = build(treeData.atlas_passives);

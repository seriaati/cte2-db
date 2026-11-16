// Client-safe rules for spending talent points. They mirror TalentsData.canAllocate and
// TalentsData.canRemove in Mine and Slash.
import type { TalentTree } from './talents';

// For each node, the nodes it is linked to.
export function neighbours(tree: TalentTree): number[][] {
  const links: number[][] = tree.nodes.map(() => []);
  for (const [a, b] of tree.edges) {
    links[a].push(b);
    links[b].push(a);
  }
  return links;
}

const perkOf = (tree: TalentTree, node: number) => tree.perks[tree.nodes[node][2]];

// Why a node can't be taken, or null when it can. Points are counted by the caller.
export function blocked(tree: TalentTree, links: number[][], taken: Set<number>, node: number): 'start' | 'link' | 'kind' | null {
  const perk = perkOf(tree, node);
  if (!perk.entry && !links[node].some((n) => taken.has(n))) return taken.size ? 'link' : 'start';
  if (perk.oneKind && [...taken].some((n) => perkOf(tree, n).oneKind === perk.oneKind)) return 'kind';
  return null;
}

// The nodes to take, nearest first, to get from what is taken to a node: as few as there can be,
// and of the routes that short always the first one found, so a click gives the same route every
// time. With nothing taken yet the route sets out from an entry node. It never passes through a
// one-of-a-kind talent, which keeps it off other entry points. Null when nothing gets there.
export function route(tree: TalentTree, links: number[][], taken: Set<number>, target: number): number[] | null {
  const { oneKind } = perkOf(tree, target);
  if (taken.has(target) || (oneKind && [...taken].some((n) => perkOf(tree, n).oneKind === oneKind))) return null;
  const from = new Map<number, number | null>();
  const entries = taken.size || perkOf(tree, target).entry ? [] : tree.nodes.flatMap((_, n) => (perkOf(tree, n).entry ? [n] : []));
  for (const n of entries) from.set(n, null);
  // An entry node can be taken whatever it is next to.
  if (perkOf(tree, target).entry) from.set(target, null);
  const queue = [...[...taken].sort((a, b) => a - b), ...entries];
  for (const n of queue) {
    if (from.has(target)) break;
    for (const next of links[n]) {
      if (taken.has(next) || from.has(next) || (next !== target && perkOf(tree, next).oneKind)) continue;
      from.set(next, taken.has(n) ? null : n);
      queue.push(next);
    }
  }
  if (!from.has(target)) return null;
  const path: number[] = [];
  for (let n: number | null = target; n !== null; n = from.get(n)!) path.unshift(n);
  // The entry node a route sets out from may be of the same one-of-a-kind group as where it is going.
  const kinds = path.map((n) => perkOf(tree, n).oneKind).filter(Boolean);
  return new Set(kinds).size === kinds.length ? path : null;
}

// The taken nodes that reach a taken entry node through other taken nodes. A build holds together when that is all of them.
export function rooted(tree: TalentTree, links: number[][], taken: Set<number>): Set<number> {
  const seen = new Set([...taken].filter((n) => perkOf(tree, n).entry));
  for (const n of seen) for (const next of links[n]) if (taken.has(next)) seen.add(next);
  return seen;
}

export interface Build {
  level: number;
  bonus: number;
  nodes: number[];
}

// A build as a link carries it: the level, the bonus points, then two characters per taken node.
const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const encodeBuild = ({ level, bonus, nodes }: Build) => `${level}.${bonus}.${nodes.map((n) => DIGITS[n >> 6] + DIGITS[n & 63]).join('')}`;

// Null for anything that isn't a build on this tree. A link made before a pack update that moved
// the talents around comes out disconnected, and is turned down here.
export function decodeBuild(text: string, tree: TalentTree, links: number[][]): Build | null {
  const [level, bonus, code = ''] = text.split('.').map((part, i) => (i < 2 ? Number(part) : part)) as [number, number, string?];
  const nodes = (code.match(/../g) ?? []).map((pair) => DIGITS.indexOf(pair[0]) * 64 + DIGITS.indexOf(pair[1]));
  if (!Number.isInteger(level) || !Number.isInteger(bonus) || code.length % 2) return null;
  const taken = new Set(nodes);
  if (!nodes.every((n) => n >= 0 && n < tree.nodes.length) || rooted(tree, links, taken).size !== taken.size) return null;
  return { level, bonus, nodes };
}

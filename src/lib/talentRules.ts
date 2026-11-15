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

// A taken node can go only if each taken node next to it still reaches an entry node without it.
export function canRemove(tree: TalentTree, links: number[][], taken: Set<number>, node: number): boolean {
  const reachesEntry = (from: number) => {
    const seen = new Set<number>();
    const queue = [...links[from]];
    for (const n of queue) {
      if (n === node || !taken.has(n) || seen.has(n)) continue;
      if (perkOf(tree, n).entry) return true;
      seen.add(n);
      queue.push(...links[n]);
    }
    return false;
  };
  return links[node].every((n) => !taken.has(n) || perkOf(tree, n).entry || reachesEntry(n));
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

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatRange, rolled } from '../lib/affix';
import { blocked, decodeBuild, encodeBuild, neighbours, rooted, route } from '../lib/talentRules';
import type { TalentTree as Tree } from '../lib/talents';
import { useQuery } from '../lib/useQuery';
import { useStored } from '../lib/useStored';
import { LevelStepper } from './controls';
import { StatLine } from './StatLine';

interface Props {
  // Which of TREES this is; a build is saved under this name.
  id: string;
  // The page's own opening sentence.
  tree: Tree;
  maxLevel: number;
}

const TREES = [
  ['talents', '/talents', 'Talents'],
  ['ascendancy', '/talents/ascendancy', 'Ascendancy'],
  ['atlas', '/talents/atlas', 'Atlas'],
];

// Where the tree's centre sits inside the frame, and how far it is zoomed.
interface View {
  x: number;
  y: number;
  k: number;
}

// PerkButton.SPACING in Mine and Slash: pixels between grid cells before any zoom.
const SPACING = 26;
const MAX_ZOOM = 3;

interface NodesProps {
  tree: Tree;
  labels: string[];
  // Perks the search matches, nodes that have a point in them, and nodes the next point could go in.
  lit: Set<number> | null;
  taken: Set<number>;
  open: Set<number>;
}

// Kept apart from the pan and zoom state so that moving the tree doesn't re-render every node.
const Nodes = memo(function Nodes({ tree, labels, lit, taken, open }: NodesProps) {
  const line = ([a, b]: [number, number]) =>
    `M${tree.nodes[a][0] * SPACING} ${tree.nodes[a][1] * SPACING}L${tree.nodes[b][0] * SPACING} ${tree.nodes[b][1] * SPACING}`;
  return (
    <>
      <svg className="edges" aria-hidden="true">
        <path d={tree.edges.map(line).join('')} />
        <path className="on" d={tree.edges.filter(([a, b]) => taken.has(a) && taken.has(b)).map(line).join('')} />
      </svg>
      {tree.nodes.map(([x, y, p], i) => (
        <button
          key={i}
          type="button"
          className={`node ${tree.perks[p].type.toLowerCase()} ${taken.has(i) ? 'on' : open.has(i) ? 'open' : ''} ${lit && !lit.has(p) ? 'dim' : ''}`}
          style={{ left: x * SPACING, top: y * SPACING, '--icon': tree.perks[p].icon } as React.CSSProperties}
          data-node={i}
          aria-label={labels[p]}
          aria-pressed={taken.has(i)}
        />
      ))}
    </>
  );
});

const nodeOf = (e: React.SyntheticEvent) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-node]');
  return el ? Number(el.dataset.node) : null;
};

interface EditorProps {
  tree: Tree;
  level: number;
  bonus: number;
  // The nodes that have a point in them.
  nodes: number[];
  onBonus: (bonus: number) => void;
  onNodes: (nodes: number[]) => void;
  // What starts the row of controls: the way to the other trees.
  nav: React.ReactNode;
  maxLevel: number;
  // Left out where the level is set elsewhere, or doesn't matter to the tree.
  onLevel?: (level: number) => void;
  // Copies a link to the build and says whether it could. Left out where the tree is part of a larger build.
  onShare?: () => Promise<boolean>;
}

// The tree itself, with its points and search. What is spent on it is kept by whoever renders it.
export function TreeEditor({ tree, level, bonus, nodes: stored, onBonus: setBonus, onNodes: setStored, nav, maxLevel, onLevel, onShare }: EditorProps) {
  const { points } = tree;
  const [query, setQuery] = useQuery();
  const [view, setView] = useState<View | null>(null);
  const [active, setActive] = useState<number | null>(null);
  // Only one of the two lists laid over the tree is open at a time.
  const [panel, setPanel] = useState<'found' | 'totals' | null>(null);
  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const app = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);

  const lines = useMemo(
    () => tree.perks.map((perk) => perk.stats.map((s) => formatRange(s, rolled(s, 100, level), rolled(s, 100, level)))),
    [tree, level],
  );
  const labels = useMemo(
    () =>
      tree.perks.map((perk, i) =>
        [perk.name, perk.type === 'MAJOR' && 'Game changer', ...lines[i].map((l) => `${l.value} ${l.label}`.trim())].filter(Boolean).join(', '),
      ),
    [tree, lines],
  );
  // How many nodes hold each perk.
  const counts = useMemo(() => tree.nodes.reduce((n, [, , p]) => (n[p]++, n), tree.perks.map(() => 0)), [tree]);
  const lit = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? new Set(labels.flatMap((label, i) => (label.toLowerCase().includes(q) ? [i] : []))) : null;
  }, [labels, query]);
  const matches = lit && [...lit].reduce((n, p) => n + counts[p], 0);

  const links = useMemo(() => neighbours(tree), [tree]);
  const taken = useMemo(() => new Set(stored), [stored]);
  // PlayerPointsType.getFreePoints in Mine and Slash.
  const total = Math.min(points.maxTotal, points.base + Math.trunc(level * points.perLevel) + bonus);
  const hasPoints = taken.size < total;
  const open = useMemo(
    () => new Set(hasPoints ? tree.nodes.flatMap((_, i) => (taken.has(i) || blocked(tree, links, taken, i) ? [] : [i])) : []),
    [tree, links, taken, hasPoints],
  );
  // The taken nodes that stay when one goes: those that still reach an entry node without it.
  const without = (i: number) => rooted(tree, links, new Set(stored.filter((n) => n !== i)));
  // A click on a taken node gives it back along with everything that hangs on it; a click on any
  // other takes it and the nodes on the way to it, when there are points for all of them.
  const toggle = (i: number) => {
    if (taken.has(i)) {
      const kept = without(i);
      return setStored(stored.filter((n) => kept.has(n)));
    }
    const path = route(tree, links, taken, i);
    if (path && taken.size + path.length <= total) setStored([...stored, ...path]);
  };

  // InCalcStatData.add in Mine and Slash: flat and increased values add up, "more" values multiply.
  const totals = useMemo(() => {
    const sums = new Map<string, { mod: Tree['perks'][number]['stats'][number]; value: number }>();
    for (const node of taken) {
      for (const mod of tree.perks[tree.nodes[node][2]].stats) {
        const value = rolled(mod, 100, level);
        const sum = sums.get(`${mod.id} ${mod.type}`);
        if (!sum) sums.set(`${mod.id} ${mod.type}`, { mod, value });
        else sum.value = mod.type === 'MORE' ? ((1 + sum.value / 100) * (1 + value / 100) - 1) * 100 : sum.value + value;
      }
    }
    return [...sums.values()].sort((a, b) => a.mod.name.localeCompare(b.mod.name)).map(({ mod, value }) => formatRange(mod, value, value));
  }, [tree, taken, level]);

  const share = async () => {
    if (!(await onShare!())) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // The box that holds the whole tree, in pixels before any zoom: its middle and its size with some room to spare.
  const bounds = useMemo(() => {
    const [xs, ys] = [0, 1].map((axis) => tree.nodes.map((node) => node[axis] * SPACING));
    const span = (v: number[]) => ({ mid: (Math.min(...v) + Math.max(...v)) / 2, size: Math.max(...v) - Math.min(...v) + 4 * SPACING });
    return { x: span(xs), y: span(ys) };
  }, [tree]);
  const minZoom = () => Math.min(frame.current!.clientWidth / bounds.x.size, frame.current!.clientHeight / bounds.y.size);
  // Opens on the whole tree, unless that would make it too small to read; then it opens closer in.
  const reset = () => {
    const k = minZoom() < 0.2 ? 0.5 : minZoom();
    setView({ x: frame.current!.clientWidth / 2 - bounds.x.mid * k, y: frame.current!.clientHeight / 2 - bounds.y.mid * k, k });
  };

  // Where the inside of the frame starts on screen, past its border.
  const origin = () => {
    const box = frame.current!.getBoundingClientRect();
    return [box.left + frame.current!.clientLeft, box.top + frame.current!.clientTop];
  };

  // Zooms around a point in the frame, which stays where it is on screen.
  const zoom = (factor: number, px = frame.current!.clientWidth / 2, py = frame.current!.clientHeight / 2) =>
    setView((v) => {
      if (!v) return v;
      const k = Math.min(MAX_ZOOM, Math.max(minZoom(), v.k * factor));
      return { x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k, k };
    });

  useEffect(() => {
    reset();
    const el = frame.current!;
    // React listens for the wheel passively, which can't stop the page from scrolling.
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.tree-list')) return;
      e.preventDefault();
      const [left, top] = origin();
      zoom(Math.exp(-e.deltaY * 0.002), e.clientX - left, e.clientY - top);
    };
    el.addEventListener('wheel', wheel, { passive: false });

    // When the frame changes size, as it does going fullscreen, the same part of the tree stays in the middle.
    let [w, h] = [el.clientWidth, el.clientHeight];
    const resized = new ResizeObserver(() => {
      const [dw, dh] = [el.clientWidth - w, el.clientHeight - h];
      [w, h] = [el.clientWidth, el.clientHeight];
      setView((v) => v && { ...v, x: v.x + dw / 2, y: v.y + dh / 2 });
    });
    resized.observe(el);

    const fullscreen = () => setFull(document.fullscreenElement === app.current);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => {
      el.removeEventListener('wheel', wheel);
      resized.disconnect();
      document.removeEventListener('fullscreenchange', fullscreen);
    };
  }, []);

  const toggleFull = () => {
    // iPhones can't put an element in fullscreen, so there the tree fills the window instead.
    if (!app.current!.requestFullscreen) setFull(!full);
    else if (document.fullscreenElement) document.exitFullscreen();
    else app.current!.requestFullscreen();
  };

  const press = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('.tree-ui')) return;
    if (!pointers.current.size) dragged.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const release = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (e.type === 'pointerleave') setActive(null);
  };
  const move = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    const [dx, dy] = [e.clientX - last.x, e.clientY - last.y];
    // A press turns into a drag only after it has moved a little, so a click on a talent still lands.
    if (!dragged.current && Math.hypot(dx, dy) < 4) return;
    dragged.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const other = [...pointers.current].find(([id]) => id !== e.pointerId)?.[1];
    if (!other) return setView((v) => v && { ...v, x: v.x + dx, y: v.y + dy });
    // Two fingers: follow the point midway between them and zoom by how much the gap changed.
    const [left, top] = origin();
    setView((v) => v && { ...v, x: v.x + dx / 2, y: v.y + dy / 2 });
    zoom(
      Math.hypot(e.clientX - other.x, e.clientY - other.y) / Math.hypot(last.x - other.x, last.y - other.y),
      (e.clientX + other.x) / 2 - left,
      (e.clientY + other.y) / 2 - top,
    );
  };
  const click = (e: React.MouseEvent) => {
    if (dragged.current) return;
    const i = nodeOf(e);
    setActive(i);
    if (i !== null) toggle(i);
  };

  // Tabbing to a talent that is out of sight brings it to the middle of the frame.
  const focus = (e: React.FocusEvent) => {
    const i = nodeOf(e);
    setActive(i);
    if (i === null) return;
    const { clientWidth: w, clientHeight: h } = frame.current!;
    setView((v) => {
      if (!v) return v;
      const [x, y] = [v.x + tree.nodes[i][0] * SPACING * v.k, v.y + tree.nodes[i][1] * SPACING * v.k];
      if (x > 40 && x < w - 40 && y > 40 && y < h - 40) return v;
      return { ...v, x: v.x + w / 2 - x, y: v.y + h / 2 - y };
    });
  };

  // What a click on a node would do beyond taking or giving back that one node, or why it would do
  // nothing. The tooltip already spells out a one-of-a-kind clash.
  const hint = (i: number) => {
    if (taken.has(i)) {
      const others = taken.size - 1 - without(i).size;
      return others ? `Taking it back also takes back ${others} ${others > 1 ? 'talents that connect' : 'talent that connects'} through it.` : '';
    }
    const path = route(tree, links, taken, i);
    if (!path) return blocked(tree, links, taken, i) === 'kind' ? '' : 'No route leads here from the talents you have taken.';
    const left = total - taken.size;
    if (path.length > left) return path.length > 1 ? `Takes ${path.length} points to reach, and ${Math.max(0, left)} ${left === 1 ? 'is' : 'are'} left.` : 'No points left.';
    return path.length > 1 ? `Takes ${path.length} points: the talents on the way here are taken too.` : '';
  };

  const tip = () => {
    if (active === null || !view) return null;
    const [gx, gy, p] = tree.nodes[active];
    const perk = tree.perks[p];
    const { clientWidth: w, clientHeight: h } = frame.current!;
    const [x, y] = [view.x + gx * SPACING * view.k, view.y + gy * SPACING * view.k];
    // The tooltip opens toward whichever side of the frame has more room.
    const [left, top] = [x < w / 2, y < h / 2];
    const width = Math.min(320, w - 16);
    const gap = 20 * view.k + 4;
    const style = {
      maxWidth: width,
      [left ? 'left' : 'right']: Math.max(8, Math.min(left ? x - 20 : w - x - 20, w - width - 8)),
      [top ? 'top' : 'bottom']: (top ? y : h - y) + gap,
    };
    return (
      <div className="talent-tip plain" style={style}>
        {perk.name && <strong>{perk.name}</strong>}
        {perk.type === 'MAJOR' && <span className="cap">Game changer</span>}
        {lines[p].map((line, i) => (
          <div key={i}>
            <StatLine line={line} />
          </div>
        ))}
        {perk.oneKind && <p>You can only take one {perk.oneKind} talent.</p>}
        {hint(active) && <p>{hint(active)}</p>}
      </div>
    );
  };

  return (
    <div ref={app} className={`tree-app ${full ? 'full' : ''}`}>
      <div className="controls">
        <div className="field">
          <span className="cap" id="tree-label">
            Tree
          </span>
          {nav}
        </div>
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Name or stat" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {onLevel && <LevelStepper value={level} max={maxLevel} onChange={onLevel} />}
        <label className="field">
          <span className="cap">{points.perLevel ? 'Bonus points' : 'Points'}</span>
          <input
            className="in bonus"
            type="number"
            min={0}
            max={points.maxBonus}
            value={bonus}
            onChange={(e) => setBonus(Math.min(points.maxBonus, Math.max(0, e.target.valueAsNumber || 0)))}
          />
        </label>
      </div>

      <div
        ref={frame}
        className={`tree-frame ${view && view.k >= 1 ? 'crisp' : ''}`}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onPointerOver={(e) => e.pointerType === 'mouse' && setActive(nodeOf(e))}
        onClick={click}
        onFocus={focus}
        onBlur={() => setActive(null)}
      >
        {view && (
          <div className="tree" style={{ transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.k})` }}>
            <Nodes tree={tree} labels={labels} lit={lit} taken={taken} open={open} />
          </div>
        )}
        {tip()}
        {lit && (
          <div className="tree-ui tree-found">
            <button
              className="btn"
              type="button"
              aria-expanded={panel === 'found'}
              disabled={!matches}
              onClick={() => setPanel(panel === 'found' ? null : 'found')}
            >
              {matches} found
            </button>
            {panel === 'found' && lit.size > 0 && (
              <ul className="tree-list plain">
                {[...lit].map((p) => (
                  <li key={p}>
                    <span className="perk-icon" style={{ '--icon': tree.perks[p].icon } as React.CSSProperties} />
                    <div>
                      {tree.perks[p].name && <strong>{tree.perks[p].name}</strong>}
                      {lines[p].map((line, i) => (
                        <div key={i}>
                          <StatLine line={line} />
                        </div>
                      ))}
                    </div>
                    {counts[p] > 1 && <span className="times">×{counts[p]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="tree-ui tree-tools">
          <button className="btn" type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}>
            -
          </button>
          <button className="btn" type="button" aria-label="Zoom in" onClick={() => zoom(1.5)}>
            +
          </button>
          <button className="btn" type="button" aria-label="Fullscreen" aria-pressed={full} onClick={toggleFull}>
            <svg viewBox="0 0 7 7" width="21" height="21" shapeRendering="crispEdges" aria-hidden="true">
              <path fill="currentColor" d="M0 0h3v1h-2v2h-1zM4 0h3v3h-1v-2h-2zM0 4h1v2h2v1h-3zM6 4h1v3h-3v-1h2z" />
            </svg>
          </button>
          <button className="btn" type="button" onClick={reset}>
            Reset
          </button>
        </div>
        <div className="tree-ui tree-points">
          <div>
            <span className={`count ${taken.size > total ? 'over' : ''}`}>
              {taken.size} / {total} points
            </span>
            <button
              className="btn"
              type="button"
              aria-expanded={panel === 'totals'}
              disabled={!taken.size}
              onClick={() => setPanel(panel === 'totals' ? null : 'totals')}
            >
              Totals
            </button>
            {onShare && (
              <button className="btn" type="button" disabled={!taken.size} onClick={share}>
                {copied ? 'Copied' : 'Share'}
              </button>
            )}
            <button className="btn" type="button" disabled={!taken.size} onClick={() => setStored([])}>
              Clear
            </button>
          </div>
          {panel === 'totals' && taken.size > 0 && (
            <ul className="tree-list plain">
              {totals.map((line, i) => (
                <li key={i}>
                  <div>
                    <StatLine line={line} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TalentTree({ id, tree, maxLevel }: Props) {
  const { points } = tree;
  // Level only matters where it gives points or grows a stat, which on the atlas tree it never does.
  const levelled = points.perLevel > 0 || tree.perks.some((perk) => perk.stats.some((s) => s.scaling));
  const [level, setLevel] = useStored('level', maxLevel);
  // Trees that give no points per level are planned with every point they can ever have.
  const [bonus, setBonus] = useStored(`${id}Bonus`, points.perLevel ? 0 : points.maxBonus);
  const [stored, setStored] = useStored<number[]>(id, []);

  // A build opened from a link takes the place of the saved one, and leaves the address bar so
  // that a reload doesn't bring it back over later changes.
  useEffect(() => {
    const load = () => {
      const build = decodeBuild(location.hash.slice(1), tree, neighbours(tree));
      if (!build) return;
      history.replaceState(null, '', location.pathname);
      let saved = '[]';
      try {
        saved = localStorage.getItem(id) ?? saved;
      } catch {}
      if (saved !== '[]' && saved !== JSON.stringify(build.nodes) && !confirm('Replace your saved talents with the build in this link?')) return;
      setLevel(Math.min(maxLevel, Math.max(1, build.level)));
      setBonus(Math.min(points.maxBonus, Math.max(0, build.bonus)));
      setStored(build.nodes);
    };
    load();
    addEventListener('hashchange', load);
    return () => removeEventListener('hashchange', load);
  }, []);

  const share = async () => {
    const link = `${location.origin}${location.pathname}#${encodeBuild({ level, bonus, nodes: stored })}`;
    // The clipboard is off limits on pages not served over HTTPS; there the link is shown to copy by hand.
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      prompt('Copy this link', link);
      return false;
    }
  };

  return (
    <div className="content">
      <div className="title-row">
        <h1>{TREES.find(([name]) => name === id)![2]}</h1>
        {levelled && <span className="context">Lv {level}</span>}
      </div>

      <TreeEditor
        tree={tree}
        level={level}
        bonus={bonus}
        nodes={stored}
        onBonus={setBonus}
        onNodes={setStored}
        nav={
          <nav className="seg" aria-labelledby="tree-label">
            {TREES.map(([name, href, label]) => (
              <a key={name} className="btn" href={href} aria-current={name === id ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
        }
        maxLevel={maxLevel}
        onLevel={levelled ? setLevel : undefined}
        onShare={share}
      />
    </div>
  );
}

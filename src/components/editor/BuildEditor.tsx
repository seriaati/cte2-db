import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { jewelSockets } from '../../lib/buildCalc';
import { AUGMENT_SLOTS, GEAR_SLOTS, TREES, emptyBuild, exportBuild, importBuild, pointsAt, readBuild, type Build, type Pool } from '../../lib/buildRules';
import type { Core } from '../../lib/builds';
import { LevelStepper } from '../controls';
import AugmentsTab from './AugmentsTab';
import CalculatorTab from './CalculatorTab';
import DamageTab from './DamageTab';
import DefenseTab from './DefenseTab';
import GearTab from './GearTab';
import JewelsTab from './JewelsTab';
import SkillsTab from './SkillsTab';
import StatsTab from './StatsTab';
import Summary from './Summary';
import TalentsTab from './TalentsTab';

const STORE = 'builds';
const PANEL = 'build-stats-panel';
const TABS = ['skills', 'talents', 'stats', 'gear', 'augments', 'jewels', 'calculator', 'damage', 'defense'] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { skills: 'Skills', talents: 'Talents', stats: 'Stat points', gear: 'Gear', augments: 'Augments', jewels: 'Jewels', calculator: 'Stats', damage: 'Damage', defense: 'Defense' };

// Screens with room for a summary of the build beside the editor.
const DESKTOP = '(min-width: 1280px)';
const watchDesktop = (notify: () => void) => {
  const media = matchMedia(DESKTOP);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

// Drawn on an 8 x 8 pixel grid. Where the database has a page for the same thing, the icon is that page's.
const ICONS: Record<Tab, string> = {
  skills: 'M6 0h2v1h-2zM4 1h3v1h-3zM2 2h5v1h-5zM1 3h6v1h-6zM0 4h3v1h-3zM5 4h2v1h-2zM0 5h3v1h-3zM5 5h2v1h-2zM0 6h6v1h-6zM1 7h4v1h-4z',
  talents: 'M2 0h4v1h-4zM1 1h6v1h-6zM0 2h3v1h-3zM5 2h3v1h-3zM0 3h2v1h-2zM6 3h2v1h-2zM0 4h2v1h-2zM6 4h2v1h-2zM0 5h3v1h-3zM5 5h3v1h-3zM1 6h6v1h-6zM2 7h4v1h-4z',
  stats: 'M3 1h2v2h-2zM1 3h6v2h-6zM3 5h2v2h-2z',
  gear: 'M1 1h2v1h-2zM5 1h2v1h-2zM0 2h2v1h-2zM3 2h2v1h-2zM6 2h2v1h-2zM0 3h8v1h-8zM2 4h4v1h-4zM2 5h4v1h-4zM2 6h4v1h-4z',
  augments: 'M4 0h1v1h-1zM3 1h3v1h-3zM3 2h3v1h-3zM1 3h1v1h-1zM3 3h3v1h-3zM0 4h3v1h-3zM4 4h3v1h-3zM0 5h3v1h-3zM4 5h3v1h-3zM0 6h3v1h-3zM4 6h3v1h-3zM1 7h1v1h-1zM4 7h2v1h-2z',
  jewels: 'M2 0h4v1h-4zM1 1h1v1h-1zM6 1h1v1h-1zM0 2h1v1h-1zM3 2h2v1h-2zM7 2h1v1h-1zM0 3h1v1h-1zM2 3h4v1h-4zM7 3h1v1h-1zM0 4h1v1h-1zM2 4h4v1h-4zM7 4h1v1h-1zM0 5h1v1h-1zM3 5h2v1h-2zM7 5h1v1h-1zM1 6h1v1h-1zM6 6h1v1h-1zM2 7h4v1h-4z',
  calculator: 'M6 0h2v1h-2zM6 1h2v1h-2zM3 2h2v1h-2zM6 2h2v1h-2zM3 3h2v1h-2zM6 3h2v1h-2zM0 4h2v1h-2zM3 4h2v1h-2zM6 4h2v1h-2zM0 5h2v1h-2zM3 5h2v1h-2zM6 5h2v1h-2zM0 6h2v1h-2zM3 6h2v1h-2zM6 6h2v1h-2z',
  damage: 'M6 0h2v1h-2zM5 1h3v1h-3zM4 2h3v1h-3zM1 3h1v1h-1zM3 3h3v1h-3zM1 4h4v1h-4zM2 5h2v1h-2zM1 6h1v1h-1zM3 6h2v1h-2zM0 7h1v1h-1z',
  defense: 'M1 0h6v1h-6zM0 1h8v3h-8zM1 4h6v2h-6zM2 6h4v1h-4zM3 7h2v1h-2z',
};
// The summary's bookmark: a short list.
const SUMMARY_ICON = 'M0 0h2v2h-2zM3 0h5v2h-5zM0 3h2v2h-2zM3 3h5v2h-5zM0 6h2v2h-2zM3 6h5v2h-5z';

interface Saved {
  current: number;
  builds: Build[];
}

function restore(core: Core): Saved {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    const builds: Build[] = (stored?.builds ?? []).flatMap((b: unknown) => readBuild(b, core) ?? []);
    if (builds.length) return { current: Math.min(builds.length - 1, Math.max(0, stored.current | 0)), builds };
  } catch {}
  return { current: 0, builds: [emptyBuild(core)] };
}

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

export default function BuildEditor({ core }: { core: Core }) {
  const [saved, setSaved] = useState(() => restore(core));
  const [tab, setTab] = useState<Tab>('skills');
  const [rolls, setRolls] = useState(false);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState('');
  // Counts resets, so that a tab starts over along with what it holds.
  const [resets, setResets] = useState(0);
  const menuRoot = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const build = saved.builds[saved.current];
  const desktop = useSyncExternalStore(watchDesktop, () => matchMedia(DESKTOP).matches);
  const [panel, setPanel] = useState(() => {
    try {
      return localStorage.getItem(PANEL) !== 'off';
    } catch {
      return true;
    }
  });
  // Set while the panel slides away; it is taken off the page once it is out of sight.
  const [leaving, setLeaving] = useState(false);
  const out = panel && !leaving;
  const showPanel = (show: boolean) => {
    setPanel(show);
    setLeaving(false);
    try {
      localStorage.setItem(PANEL, show ? 'on' : 'off');
    } catch {}
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {}
  }, [saved]);

  const change = (patch: Partial<Build>) => setSaved((s) => ({ ...s, builds: s.builds.map((b, i) => (i === s.current ? { ...b, ...patch } : b)) }));
  // Opens a build beside the saved ones, or goes to it when it is already among them. A lone build
  // that was never touched makes way for it.
  const open = (next: Build) =>
    setSaved((s) => {
      // Read back first, so that two builds with their fields in another order still count as one.
      const same = (a: Build, b: Build) => JSON.stringify(readBuild(a, core)) === JSON.stringify(readBuild(b, core));
      const at = s.builds.findIndex((b) => same(b, next));
      if (at >= 0) return { ...s, current: at };
      const kept = s.builds.length === 1 && same(s.builds[0], emptyBuild(core)) ? [] : s.builds;
      return { current: kept.length, builds: [...kept, next] };
    });
  const say = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 2500);
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRoot.current!.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportBuild(build, core.pack)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${build.name.replace(/[^\w -]+/g, '').trim() || 'build'}.json` });
    link.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    const read = importBuild(await picked.text(), core);
    if (read) open(read);
    say(read ? `Imported ${read.name}.` : "That file isn't a build exported from here.");
  };

  const remove = () => {
    if (!confirm(`Delete ${build.name}?`)) return;
    setSaved((s) => {
      const builds = s.builds.filter((_, i) => i !== s.current);
      return builds.length ? { current: Math.min(s.current, builds.length - 1), builds } : { current: 0, builds: [emptyBuild(core)] };
    });
  };

  const act = (action: () => void) => () => {
    setMenu(false);
    action();
  };

  // What each tab holds of the build, and the points that are spent on it. The stats, damage and defense tabs hold nothing to reset.
  const PARTS: Partial<Record<Tab, [fields: (keyof Build)[], pools: Pool[]]>> = {
    skills: [['classes', 'perks', 'hotbar'], ['spells', 'passives']],
    talents: [['trees'], [...TREES]],
    stats: [['stats'], ['stats']],
    gear: [['gear', 'codex'], []],
    augments: [['augments'], []],
    jewels: [['jewels'], []],
  };
  const resetTab = () => {
    if (!confirm(`Reset everything under ${LABELS[tab]}?`)) return;
    const fresh = emptyBuild(core);
    const [fields, pools] = PARTS[tab]!;
    change({ ...Object.fromEntries(fields.map((field) => [field, fresh[field]])), bonus: { ...build.bonus, ...Object.fromEntries(pools.map((pool) => [pool, fresh.bonus[pool]])) } });
    setResets(resets + 1);
  };
  const resetBuild = () => {
    if (!confirm(`Reset the whole of ${build.name}? Its name is kept.`)) return;
    change(emptyBuild(core, build.name));
    setResets(resets + 1);
  };

  // How far along each part is, for its tab.
  const spent = sum(Object.values(build.stats));
  const counts: Partial<Record<Tab, [done: number, of: number]>> = {
    skills: [build.hotbar.filter(Boolean).length, build.hotbar.length],
    talents: [sum(TREES.map((t) => build.trees[t].length)), sum(TREES.map((t) => pointsAt(core.points[t], build.level, build.bonus[t])))],
    stats: [spent, pointsAt(core.points.stats, build.level, build.bonus.stats)],
    gear: [Object.keys(build.gear).length + (build.codex ? 1 : 0), GEAR_SLOTS.length + 1],
    augments: [build.augments.length, AUGMENT_SLOTS],
    jewels: [build.jewels.length, jewelSockets(core, build)],
  };

  const reset = PARTS[tab] && (
    <button className="btn tab-reset" type="button" onClick={resetTab}>
      Reset {LABELS[tab]}
    </button>
  );
  const props = { core, build, change, rolls, reset };

  return (
    <>
      <div className="editor">
        <header className="editor-bar">
          <a className="btn back" href="/">
            <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
              <path fill="currentColor" d="M3 0h1v1h-1zM2 1h1v1h-1zM1 2h1v1h-1zM0 3h7v1h-7zM1 4h1v1h-1zM2 5h1v1h-1zM3 6h1v1h-1z" />
            </svg>
            Database
          </a>
          <label className="field grow build-name">
            <span className="cap">Build</span>
            <input className="in" type="text" maxLength={60} value={build.name} onChange={(e) => change({ name: e.target.value })} onBlur={() => build.name.trim() || change({ name: 'New build' })} />
          </label>
          <LevelStepper value={build.level} max={core.maxLevel} onChange={(level) => change({ level })} />
          <div className="editor-actions">
            <button className="btn" type="button" aria-pressed={rolls} title="Set the exact roll of each stat. Off, everything is at its best roll." onClick={() => setRolls(!rolls)}>
              Exact rolls
            </button>
            <div className="menu" ref={menuRoot}>
              <button className="btn" type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                Builds
              </button>
              {menu && (
                <div className="menu-list" role="menu">
                  <div className="cap">Saved in this browser</div>
                  {saved.builds.map((b, i) => (
                    <button key={i} type="button" role="menuitemradio" aria-checked={i === saved.current} onClick={act(() => setSaved({ ...saved, current: i }))}>
                      {b.name}
                      <small>Lv {b.level}</small>
                    </button>
                  ))}
                  <hr />
                  <button type="button" role="menuitem" onClick={act(() => open(emptyBuild(core, `Build ${saved.builds.length + 1}`)))}>
                    New build
                  </button>
                  <button type="button" role="menuitem" onClick={act(() => open({ ...build, name: `${build.name} copy`.slice(0, 60) }))}>
                    Duplicate
                  </button>
                  <hr />
                  <button type="button" role="menuitem" title="Save this build as a file, to keep or to send to someone" onClick={act(download)}>
                    Export to a file
                  </button>
                  <button type="button" role="menuitem" title="Open a build from a file" onClick={act(() => file.current!.click())}>
                    Import a file
                  </button>
                  <a
                    role="menuitem"
                    href="https://github.com/seriaati/cte2-talent-loader"
                    target="_blank"
                    rel="noopener"
                    title="A mod that takes an exported build and spends its talent, stat and skill points in game for you"
                    onClick={() => setMenu(false)}
                  >
                    Load into the game
                    <small>mod ↗</small>
                  </a>
                  <hr />
                  <button type="button" role="menuitem" title="Empty the whole build. Its name is kept." onClick={act(resetBuild)}>
                    Reset the whole build
                  </button>
                  <button type="button" role="menuitem" onClick={act(remove)}>
                    Delete this build
                  </button>
                </div>
              )}
            </div>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </header>

        <div className="editor-tabs">
          <nav aria-label="Parts of the build">
            {TABS.map((id) => (
              <button key={id} className="tab" type="button" aria-current={id === tab ? 'page' : undefined} onClick={() => setTab(id)}>
                <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
                  <path fill="currentColor" d={ICONS[id]} />
                </svg>
                {LABELS[id]}
                {counts[id] && (
                  <span className={`tab-count ${counts[id][0] > counts[id][1] ? 'over' : ''}`}>
                    {counts[id][0]}/{counts[id][1]}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <main className="editor-main" key={`${saved.current} ${resets}`}>
          {tab === 'skills' && <SkillsTab {...props} />}
          {tab === 'talents' && <TalentsTab {...props} />}
          {tab === 'stats' && <StatsTab {...props} />}
          {tab === 'gear' && <GearTab {...props} />}
          {tab === 'augments' && <AugmentsTab {...props} />}
          {tab === 'jewels' && <JewelsTab {...props} />}
          {tab === 'calculator' && <CalculatorTab {...props} />}
          {tab === 'damage' && <DamageTab {...props} />}
          {tab === 'defense' && <DefenseTab {...props} />}
        </main>

        {notice && (
          <div className="editor-notice" role="status">
            {notice}
          </div>
        )}
      </div>
      {/* A bookmark on the panel's edge: it tucks the panel away, and stays at the side of the page to pull it back out. */}
      {desktop && (
        <button
          className={`stats-mark ${out ? 'out' : ''}`}
          type="button"
          aria-expanded={out}
          title={out ? 'Hide the summary' : 'Show the summary'}
          aria-label={out ? 'Hide the summary' : 'Show the summary'}
          onClick={() => (out ? setLeaving(true) : showPanel(true))}
        >
          <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
            <path fill="currentColor" d={SUMMARY_ICON} />
          </svg>
          <svg className="stats-mark-arrow" viewBox="0 0 4 7" width="8" height="14" shapeRendering="crispEdges" aria-hidden="true">
            <path fill="currentColor" d="M0 0h1v1h-1zM1 1h1v1h-1zM2 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM1 5h1v1h-1zM0 6h1v1h-1z" />
          </svg>
        </button>
      )}
      {desktop && panel && (
        <aside
          className={`stats-side plain ${leaving ? 'leaving' : ''}`}
          aria-label="Summary of the build"
          // Animations of what is inside the panel end here too; only its own counts.
          onAnimationEnd={(e) => leaving && e.target === e.currentTarget && showPanel(false)}
        >
          <h2>Summary</h2>
          <Summary core={core} build={build} />
        </aside>
      )}
    </>
  );
}

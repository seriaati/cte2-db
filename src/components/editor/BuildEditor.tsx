import { useEffect, useRef, useState } from 'react';
import { AUGMENT_SLOTS, GEAR_SLOTS, TREES, emptyBuild, exportBuild, importBuild, pointsAt, readBuild, type Build, type Pool } from '../../lib/buildRules';
import type { Core } from '../../lib/builds';
import { LevelStepper } from '../controls';
import AugmentsTab from './AugmentsTab';
import GearTab from './GearTab';
import JewelsTab, { jewelSockets } from './JewelsTab';
import SkillsTab from './SkillsTab';
import StatsTab from './StatsTab';
import TalentsTab from './TalentsTab';

const STORE = 'builds';
const TABS = ['skills', 'talents', 'stats', 'gear', 'augments', 'jewels'] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { skills: 'Skills', talents: 'Talents', stats: 'Stat points', gear: 'Gear', augments: 'Augments', jewels: 'Jewels' };

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

  // What each tab holds of the build, and the points that are spent on it.
  const PARTS: Record<Tab, [fields: (keyof Build)[], pools: Pool[]]> = {
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
    const [fields, pools] = PARTS[tab];
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
  const counts: Record<Tab, [done: number, of: number]> = {
    skills: [build.hotbar.filter(Boolean).length, build.hotbar.length],
    talents: [sum(TREES.map((t) => build.trees[t].length)), sum(TREES.map((t) => pointsAt(core.points[t], build.level, build.bonus[t])))],
    stats: [spent, pointsAt(core.points.stats, build.level, build.bonus.stats)],
    gear: [Object.keys(build.gear).length + (build.codex ? 1 : 0), GEAR_SLOTS.length + 1],
    augments: [build.augments.length, AUGMENT_SLOTS],
    jewels: [build.jewels.length, jewelSockets(core, build)],
  };

  const props = { core, build, change, rolls };

  return (
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
          <button className="btn primary" type="button" title="Save this build as a file, to keep or to send to someone" onClick={download}>
            Export
          </button>
          <button className="btn" type="button" title="Open a build from a file" onClick={() => file.current!.click()}>
            Import
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
                <button type="button" role="menuitem" onClick={act(resetBuild)}>
                  Reset
                </button>
                <button type="button" role="menuitem" onClick={act(remove)}>
                  Delete
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
              {LABELS[id]}
              <span className={`tab-count ${counts[id][0] > counts[id][1] ? 'over' : ''}`}>
                {counts[id][0]}/{counts[id][1]}
              </span>
            </button>
          ))}
        </nav>
        <div className="tab-tools">
          <button className="btn" type="button" onClick={resetTab}>
            Reset {LABELS[tab]}
          </button>
          <button className="btn" type="button" aria-pressed={rolls} title="Set the exact roll of each stat. Off, everything is at its best roll." onClick={() => setRolls(!rolls)}>
            Exact rolls
          </button>
        </div>
      </div>

      <main className="editor-main" key={`${saved.current} ${resets}`}>
        {tab === 'skills' && <SkillsTab {...props} />}
        {tab === 'talents' && <TalentsTab {...props} />}
        {tab === 'stats' && <StatsTab {...props} />}
        {tab === 'gear' && <GearTab {...props} />}
        {tab === 'augments' && <AugmentsTab {...props} />}
        {tab === 'jewels' && <JewelsTab {...props} />}
      </main>

      {notice && (
        <div className="editor-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

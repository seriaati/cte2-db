import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RETRIBUTION, type Build } from '../../lib/buildRules';
import type { Core, Sections } from '../../lib/builds';
import { matches, type Part } from '../../lib/plannerRules';
import { StatLines } from '../StatLine';

// What every part of the editor is given.
export interface TabProps {
  core: Core;
  build: Build;
  change: (patch: Partial<Build>) => void;
  // Whether rolls are shown and can be set; off, every part is at its best roll.
  rolls: boolean;
  // The button that empties this part of the build, for the tab to put by its heading.
  reset: ReactNode;
}

const loaded = new Map<string, unknown>();
const loading = new Map<string, Promise<unknown>>();

// Game data for one part of the editor, fetched the first time it is asked for. Null until it arrives.
export function useSection<K extends keyof Sections>(name: K): Sections[K] | null {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (loaded.has(name)) return;
    let live = true;
    if (!loading.has(name)) loading.set(name, fetch(`/build-data/${name}.json`).then((response) => response.json()));
    loading.get(name)!.then((data) => {
      loaded.set(name, data);
      if (live) refresh((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [name]);
  return (loaded.get(name) as Sections[K] | undefined) ?? null;
}

export const Loading = () => <p className="empty">Loading…</p>;

export interface Choice {
  id: string;
  name: string;
  icon?: string;
  // A picture of a piece of gear, which is larger than the other icons.
  picture?: string;
  // The stats it gives, shown beside the name and searched along with it.
  part?: Part;
  note?: ReactNode;
  // The colour its stat values take; the one around the picker when left out.
  ink?: string;
  // Why it can't be picked; set, the choice is listed but can't be chosen.
  off?: string;
  group?: string;
}

interface PickerProps {
  title: string;
  choices: Choice[];
  onPick: (id: string) => void;
  onClose: () => void;
}

// A searchable list in a dialog, for filling a slot. It looks and behaves like the site's search box.
export function Picker({ title, choices, onPick, onClose }: PickerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  useEffect(() => dialog.current!.showModal(), []);

  const shown = choices.filter((c) => (c.part ? matches(query, c.name, c.part) : c.name.toLowerCase().includes(query)));
  const groups = [...new Set(shown.map((c) => c.group ?? ''))];

  return (
    <dialog
      ref={dialog}
      className="search picker"
      aria-label={title}
      onClose={onClose}
      // A click on the dialog itself, not on something in it, landed on the backdrop.
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <form method="dialog">
        <input className="in" type="text" placeholder={title} aria-label="Search" autoComplete="off" spellCheck={false} autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" aria-label="Close">
          ×
        </button>
      </form>
      <div className="search-results">
        {shown.length === 0 && <p className="empty">Nothing matches.</p>}
        {groups.map((group) => (
          <section key={group}>
            {group && <div className="cap picker-group">{group}</div>}
            <ul>
              {shown
                .filter((c) => (c.group ?? '') === group)
                .map((c) => (
                  <li key={c.id}>
                    <button
                      className="row opt pick"
                      type="button"
                      disabled={!!c.off}
                      style={c.ink ? ({ '--rar': c.ink } as CSSProperties) : undefined}
                      // Closed by hand: what was picked can take this dialog off the page before its close event comes.
                      onClick={() => {
                        onPick(c.id);
                        onClose();
                      }}
                    >
                      <span className="name socket-name">
                        {c.icon && <img className="socket-sprite" src={c.icon} alt="" width={24} height={24} />}
                        {c.picture && <img className="gear-sprite" src={c.picture} alt="" width={32} height={32} />}
                        {c.name}
                      </span>
                      <span className="stats">
                        {c.part && <StatLines {...c.part} />}
                        {c.note && <span className="line open">{c.note}</span>}
                        {c.off && <span className="line open">{c.off}</span>}
                      </span>
                      <span className="mark" aria-hidden="true">
                        {!c.off && '+'}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </dialog>
  );
}

// Settings that float over the page under their button; a click anywhere else puts them away.
export function Popover({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) box.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details className="more float" ref={box}>
      <summary className="btn">{label}</summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

// A whole number typed into a small box, kept inside its limits.
export function NumberField(props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; suffix?: string }) {
  const { label, value, min, max, onChange, suffix } = props;
  return (
    <label className="field number">
      <span className="cap">{label}</span>
      <span className="number-box">
        <input
          className="in"
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number.isNaN(e.target.valueAsNumber) ? min : Math.trunc(e.target.valueAsNumber))))}
        />
        {suffix}
      </span>
    </label>
  );
}

// How many Retribution stacks a Crusader is taken to hold, for the tabs whose numbers they change.
export function RetributionField({ build, change }: Pick<TabProps, 'build' | 'change'>) {
  const skills = useSection('skills');
  if (!skills || !build.classes.includes(RETRIBUTION.class)) return null;
  const { name, max } = skills.retribution;
  return <NumberField label={`${name} stacks`} value={Math.min(max, build.retribution)} min={0} max={max} onChange={(retribution) => change({ retribution })} />;
}

interface SlotProps {
  label: string;
  // Left out, the slot is empty and offers to be filled.
  name?: ReactNode;
  children?: ReactNode;
  onPick?: () => void;
  onRemove?: () => void;
  // The roll, where rolls are being set: its value and the window it has to stay in.
  roll?: { value: number; min: number; max: number; onChange: (roll: number) => void };
  // Why an empty slot can't be filled.
  locked?: string;
}

// One place something goes: an affix, a socket, a support gem. Empty, the whole of it is a button.
export function Slot({ label, name, children, onPick, onRemove, roll, locked }: SlotProps) {
  if (name === undefined) {
    return (
      <li className="slot empty-slot">
        <button className="slot-add" type="button" disabled={!!locked || !onPick} onClick={onPick}>
          <span className="cap">{label}</span>
          <span>{locked ?? 'Empty'}</span>
          {!locked && (
            <span className="mark" aria-hidden="true">
              +
            </span>
          )}
        </button>
      </li>
    );
  }
  return (
    <li className="slot filled">
      <span className="name">
        <span className="cap">{label}</span>
        {name}
      </span>
      <span className="stats">{children}</span>
      <span className="slot-tools">
        {roll && roll.min < roll.max && (
          <label className="roll">
            <input
              className="in"
              type="number"
              min={roll.min}
              max={roll.max}
              value={roll.value}
              aria-label={`${label} roll`}
              onChange={(e) => roll.onChange(Math.min(roll.max, Math.max(roll.min, Math.trunc(e.target.valueAsNumber) || roll.min)))}
            />
            %
          </label>
        )}
        {onPick && (
          <button className="btn remove swap" type="button" aria-label={`Change ${label}`} title="Change" onClick={onPick}>
            <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
              <path fill="currentColor" d="M4 0h1v1h1v1h-6v-1h4zM1 4h6v1h-4v1h-1v-1h-1z" />
            </svg>
          </button>
        )}
        {onRemove && (
          <button className="btn remove" type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
            ×
          </button>
        )}
      </span>
    </li>
  );
}

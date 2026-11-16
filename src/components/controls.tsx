import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Base, Icon, Rarity } from '../lib/affix';
import { play } from '../lib/motion';

const FAMILIES = [
  { id: 'Weapon', label: 'Weapons' },
  { id: 'OffHand', label: 'Off-hand' },
  { id: 'Armor', label: 'Armor' },
  { id: 'Jewelry', label: 'Jewelry' },
];

const ARMOR_SLOTS = [
  { id: 'helmet', label: 'Helm' },
  { id: 'chest', label: 'Chest' },
  { id: 'pants', label: 'Pants' },
  { id: 'boots', label: 'Boots' },
];

export function GearIcon({ icon }: { icon: Icon }) {
  // Small glyphs are doubled so every icon lands near the same size while staying pixel-aligned.
  const scale = Math.max(icon.w, icon.h) <= 10 ? 2 : 1;
  return (
    <span className="gear-icon" aria-hidden="true">
      <svg viewBox={`0 0 ${icon.w} ${icon.h}`} width={icon.w * scale} height={icon.h * scale}>
        <path d={icon.d} fill="currentColor" />
      </svg>
    </span>
  );
}

export interface GearOption {
  id: string;
  name: string;
  family: string;
  icon: Icon;
  bases: Base[];
}

// The gear a page can be filtered by. `entries` says what the page lists for a base: bases it lists
// nothing for are left out, and a whole family, or the materials of each armor slot, become one
// option where they all list the same.
export function gearOptions(bases: Base[], tagNames: Record<string, string>, entries: (base: Base) => string): GearOption[] {
  const listed = new Map(bases.map((b) => [b, entries(b)] as const).filter(([, list]) => list));
  const same = (group: Base[]) => group.every((b) => listed.get(b) === listed.get(group[0]));
  const option = (group: Base[], id = group[0].id, name = group[0].name): GearOption => ({ id, name, family: group[0].family, icon: group[0].icon, bases: group });
  return FAMILIES.flatMap((f) => {
    const members = [...listed.keys()].filter((b) => b.family === f.id);
    if (members.length > 1 && same(members)) return [option(members, f.id, f.label)];
    const slots = ARMOR_SLOTS.map((s) => members.filter((b) => b.slot === s.id)).filter((group) => group.length);
    if (f.id === 'Armor' && slots.every(same)) return slots.map((group) => option(group, group[0].slot, tagNames[group[0].slot]));
    return members.map((b) => option([b]));
  });
}

export const gearLabel = (options: GearOption[], selected: string[]) =>
  selected.length === 0 ? 'All gear' : selected.length === 1 ? options.find((o) => o.id === selected[0])!.name : `${selected.length} gear types`;

interface GearProps {
  options: GearOption[];
  tagNames: Record<string, string>;
  selected: string[];
  onChange: (selected: string[]) => void;
  // Label for the "no gear chosen" option, which makes the picker a filter: any number of options
  // can be on, and picking one again turns it off. Leave out when exactly one base is required.
  anyLabel?: string;
}

const picked = (selected: string[], id: string, many: boolean) => (!many ? [id] : selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

// Desktop gear picker. Hidden below 940px, where GearSelect takes over.
export function GearRail({ options, tagNames, selected, onChange, anyLabel }: GearProps) {
  const pick = (id: string) => onChange(picked(selected, id, !!anyLabel));
  const button = (o: GearOption) => (
    <button key={o.id} className="gear" type="button" aria-pressed={selected.includes(o.id)} onClick={() => pick(o.id)}>
      <GearIcon icon={o.icon} />
      {o.name}
    </button>
  );
  const families = FAMILIES.map((f) => ({ ...f, options: options.filter((o) => o.family === f.id) })).filter((f) => f.options.length);
  const whole = families.filter((f) => f.options[0].id === f.id);
  // Armor ids are <material>_<slot>, which lets the rail show them as a material × slot grid.
  const armorGrid = (armor: GearOption[]) => {
    const slot = (o: GearOption) => o.bases[0].slot;
    const materials = [...new Set(armor.map((o) => o.id.slice(0, -slot(o).length - 1)))];
    const slots = ARMOR_SLOTS.filter((s) => armor.some((o) => slot(o) === s.id));
    return (
      <div key="armor-grid" className="armor-grid" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${slots.length}, 34px)` }}>
        <span />
        {slots.map((s) => (
          <span key={s.id} className="armor-slot">
            <GearIcon icon={armor.find((o) => slot(o) === s.id)!.icon} />
            {s.label}
          </span>
        ))}
        {materials.map((material) => [
          <span key={material} className="armor-material">
            {tagNames[material]}
          </span>,
          ...slots.map((s) => {
            const o = armor.find((x) => x.id === `${material}_${s.id}`);
            return o ? (
              <button
                key={o.id}
                className="gear cell"
                type="button"
                aria-pressed={selected.includes(o.id)}
                aria-label={o.name}
                title={o.name}
                onClick={() => pick(o.id)}
              />
            ) : (
              <span key={`${material}_${s.id}`} />
            );
          }),
        ])}
      </div>
    );
  };

  return (
    <aside className="rail" aria-label="Gear type">
      <div className="rail-title">Gear</div>
      {anyLabel && (
        <button className="gear" type="button" aria-pressed={!selected.length} onClick={() => onChange([])}>
          {anyLabel}
        </button>
      )}
      {whole.length > 0 && <div className="gear-grid">{whole.map((f) => button(f.options[0]))}</div>}
      {families
        .filter((f) => !whole.includes(f))
        .map((f) => [
          <div key={f.id} className="cap">
            {f.label}
          </div>,
          f.id === 'Armor' && f.options[0].bases.length === 1 ? armorGrid(f.options) : <div key={`${f.id}-grid`} className="gear-grid">{f.options.map(button)}</div>,
        ])}
    </aside>
  );
}

export function GearSelect({ options, selected, onChange, anyLabel }: Omit<GearProps, 'tagNames'>) {
  const choice = (o: GearOption) => ({ value: o.id, label: o.name });
  const families = FAMILIES.map((f) => ({ ...f, options: options.filter((o) => o.family === f.id) })).filter((f) => f.options.length);
  const whole = families.filter((f) => f.options[0].id === f.id);
  const groups = [
    { options: [...(anyLabel ? [{ value: '', label: anyLabel }] : []), ...whole.map((f) => choice(f.options[0]))] },
    ...families.filter((f) => !whole.includes(f)).map((f) => ({ label: f.label, options: f.options.map(choice) })),
  ].filter((g) => g.options.length);
  return (
    <Dropdown
      className="gear-select"
      label="Gear"
      value={anyLabel ? (selected.length ? selected : ['']) : selected[0]}
      groups={groups}
      onChange={(id) => onChange(id ? picked(selected, id, !!anyLabel) : [])}
    />
  );
}

interface OptionGroup {
  label?: string;
  options: { value: string; label: string }[];
}

// With a list as its value the dropdown takes several: it stays open, and each pick is passed on for the caller to turn on or off.
export function Dropdown(props: { label: string; value: string | string[]; groups: OptionGroup[]; onChange: (value: string) => void; className?: string }) {
  const { label, value, groups, onChange, className = '' } = props;
  const many = Array.isArray(value);
  const chosen = [value].flat();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = groups.flatMap((g) => g.options);
  const selected = options.findIndex((o) => o.value === chosen[0]);

  // Safari doesn't focus a clicked button, so blur alone can't be relied on to close the list.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current!.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const toggle = () => {
    setActive(Math.max(0, selected));
    setOpen(!open);
  };
  const pick = (i: number) => {
    onChange(options[i].value);
    if (!many) setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) toggle();
      else setActive(Math.min(options.length - 1, Math.max(0, active + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (open && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      pick(active);
    }
  };

  return (
    <div className={`field dropdown ${className}`} ref={root}>
      <span className="cap" id={`${id}-label`}>
        {label}
      </span>
      <button
        className="in dropdown-btn"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={toggle}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span id={`${id}-value`}>{chosen.length > 1 ? `${chosen.length} selected` : options[selected]?.label}</span>
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M0 0h2v2H0zM2 2h2v2H2zM4 4h2v2H4zM6 2h2v2H6zM8 0h2v2H8z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        // Keeping the pointer from moving focus lets the button's blur close the list only on real exits.
        <ul className="dropdown-list" role="listbox" aria-multiselectable={many} aria-labelledby={`${id}-label`} onPointerDown={(e) => e.preventDefault()}>
          {groups.map((g, gi) => [
            g.label && (
              <li key={`group-${gi}`} className="cap" role="presentation">
                {g.label}
              </li>
            ),
            ...g.options.map((o) => {
              const i = options.indexOf(o);
              return (
                <li
                  key={o.value}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={chosen.includes(o.value)}
                  className={i === active ? 'active' : undefined}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  {o.label}
                </li>
              );
            }),
          ])}
        </ul>
      )}
    </div>
  );
}

export function LevelStepper({ value, max, onChange }: { value: number; max: number; onChange: (level: number) => void }) {
  const change = (v: number) => onChange(Math.min(max, Math.max(1, v || 1)));
  const input = useRef<HTMLInputElement>(null);
  const last = useRef(value);
  // Nudge the number in from the side it is heading away from. Padding moves the digits without moving the box.
  useEffect(() => {
    if (value !== last.current) play(input.current, [{ [value > last.current ? 'paddingTop' : 'paddingBottom']: '12px' }, {}], 140);
    last.current = value;
  }, [value]);
  return (
    <div className="field">
      <label className="cap" htmlFor="level">
        Level
      </label>
      <div className="stepper">
        <button className="btn ten" type="button" aria-label="Lower level by 10" onClick={() => change(value - 10)}>
          -10
        </button>
        <button className="btn" type="button" aria-label="Lower level" onClick={() => change(value - 1)}>
          -
        </button>
        <input
          id="level"
          ref={input}
          className="in"
          type="number"
          min={1}
          max={max}
          value={value}
          onChange={(e) => change(e.target.valueAsNumber)}
        />
        <button className="btn" type="button" aria-label="Raise level" onClick={() => change(value + 1)}>
          +
        </button>
        <button className="btn ten" type="button" aria-label="Raise level by 10" onClick={() => change(value + 10)}>
          +10
        </button>
      </div>
    </div>
  );
}

export function RaritySwatches(props: { rarities: Rarity[]; value: string; onChange: (rarityId: string) => void; label?: string }) {
  const { rarities, value, onChange, label = 'Rarity' } = props;
  const id = useId();
  return (
    <div className="field">
      <span className="cap" id={id}>
        {label}
      </span>
      <div className="swatches" role="group" aria-labelledby={id}>
        {rarities.map((r) => (
          <button
            key={r.id}
            className="swatch"
            type="button"
            aria-pressed={r.id === value}
            aria-label={r.name}
            title={r.name}
            style={{ '--c': r.color } as CSSProperties}
            onClick={() => onChange(r.id)}
          />
        ))}
      </div>
    </div>
  );
}

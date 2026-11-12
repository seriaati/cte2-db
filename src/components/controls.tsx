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

interface GearProps {
  bases: Base[];
  tagNames: Record<string, string>;
  value: string;
  onChange: (baseId: string) => void;
  // Label for the "no gear chosen" option; leave out when a base is required.
  anyLabel?: string;
}

// Desktop gear picker. Hidden below 940px, where GearSelect takes over.
export function GearRail({ bases, tagNames, value, onChange, anyLabel }: GearProps) {
  const family = (id: string) => bases.filter((b) => b.family === id);
  // Armor ids are <material>_<slot>, which lets the rail show them as a material × slot grid.
  const armor = family('Armor');
  const materials = [...new Set(armor.map((b) => b.id.slice(0, -b.slot.length - 1)))];
  const button = (b: Base) => (
    <button key={b.id} className="gear" type="button" aria-pressed={b.id === value} onClick={() => onChange(b.id)}>
      <GearIcon icon={b.icon} />
      {b.name}
    </button>
  );

  return (
    <aside className="rail" aria-label="Gear type">
      <div className="rail-title">Gear</div>
      {anyLabel && (
        <button className="gear" type="button" aria-pressed={!value} onClick={() => onChange('')}>
          {anyLabel}
        </button>
      )}
      <div className="cap">Weapons</div>
      <div className="gear-grid">{family('Weapon').map(button)}</div>
      <div className="cap">Off-hand</div>
      <div className="gear-grid">{family('OffHand').map(button)}</div>
      <div className="cap">Armor</div>
      <div className="armor-grid">
        <span />
        {ARMOR_SLOTS.map((s) => (
          <span key={s.id} className="armor-slot">
            <GearIcon icon={armor.find((b) => b.slot === s.id)!.icon} />
            {s.label}
          </span>
        ))}
        {materials.map((material) => [
          <span key={material} className="armor-material">
            {tagNames[material]}
          </span>,
          ...ARMOR_SLOTS.map((s) => {
            const b = armor.find((x) => x.id === `${material}_${s.id}`)!;
            return (
              <button
                key={b.id}
                className="gear cell"
                type="button"
                aria-pressed={b.id === value}
                aria-label={b.name}
                title={b.name}
                onClick={() => onChange(b.id)}
              />
            );
          }),
        ])}
      </div>
      <div className="cap">Jewelry</div>
      <div className="gear-grid">{family('Jewelry').map(button)}</div>
    </aside>
  );
}

export function GearSelect({ bases, value, onChange, anyLabel }: Omit<GearProps, 'tagNames'>) {
  const families = FAMILIES.map((f) => ({
    label: f.label,
    options: bases.filter((b) => b.family === f.id).map((b) => ({ value: b.id, label: b.name })),
  }));
  const groups = anyLabel ? [{ options: [{ value: '', label: anyLabel }] }, ...families] : families;
  return <Dropdown className="gear-select" label="Gear" value={value} groups={groups} onChange={onChange} />;
}

interface OptionGroup {
  label?: string;
  options: { value: string; label: string }[];
}

export function Dropdown(props: { label: string; value: string; groups: OptionGroup[]; onChange: (value: string) => void; className?: string }) {
  const { label, value, groups, onChange, className = '' } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = groups.flatMap((g) => g.options);
  const selected = options.findIndex((o) => o.value === value);

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
    setOpen(false);
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
        <span id={`${id}-value`}>{options[selected]?.label}</span>
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M0 0h2v2H0zM2 2h2v2H2zM4 4h2v2H4zM6 2h2v2H6zM8 0h2v2H8z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        // Keeping the pointer from moving focus lets the button's blur close the list only on real exits.
        <ul className="dropdown-list" role="listbox" aria-labelledby={`${id}-label`} onPointerDown={(e) => e.preventDefault()}>
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
                  aria-selected={i === selected}
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

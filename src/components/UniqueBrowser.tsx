import { useMemo, useState } from 'react';
import { formatStat, type Base, type Rarity } from '../lib/affix';
import type { Source, Unique } from '../lib/uniques';
import { Dropdown, gearLabel, gearOptions, GearRail, GearSelect, LevelStepper } from './controls';
import { StatLine } from './StatLine';
import { useQuery } from '../lib/useQuery';
import { useStored } from '../lib/useStored';

interface Props {
  uniques: Unique[];
  bases: Base[];
  sources: Source[];
  rarity: Rarity;
  tagNames: Record<string, string>;
  maxLevel: number;
}

const FAMILIES = [
  { id: 'Weapon', label: 'Weapons' },
  { id: 'OffHand', label: 'Off-hand' },
  { id: 'Armor', label: 'Armor' },
  { id: 'Jewelry', label: 'Jewelry' },
];

export default function UniqueBrowser({ uniques, bases, sources, rarity, tagNames, maxLevel }: Props) {
  const [query, setQuery] = useQuery();
  const [gear, setGear] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [level, setLevel] = useStored('level', maxLevel);

  const options = useMemo(
    () => gearOptions(bases, tagNames, (b) => uniques.filter((u) => u.base === b.id).map((u) => u.id).join()),
    [bases, tagNames, uniques],
  );
  const picked = useMemo(() => options.filter((o) => gear.includes(o.id)), [options, gear]);
  const source = sources.find((s) => s.id === sourceId);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = uniques
      .filter((u) => !sourceId || u.source === sourceId)
      .map((unique) => ({
        unique,
        baseIndex: bases.findIndex((b) => b.id === unique.base),
        from: sources.find((s) => s.id === unique.source)!.name,
        lines: unique.stats.map((s) => formatStat(s, rarity, level)),
      }))
      .filter((r) => !q || [r.unique.name, ...r.lines.map((l) => `${l.value} ${l.label}`)].some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => a.baseIndex - b.baseIndex || a.unique.minLevel - b.unique.minLevel || a.unique.name.localeCompare(b.unique.name));
    const all = picked.length
      ? picked.map((o) => ({ id: o.id, label: o.name, rows: rows.filter((r) => o.bases.includes(bases[r.baseIndex])) }))
      : FAMILIES.map((f) => ({ ...f, rows: rows.filter((r) => bases[r.baseIndex].family === f.id) }));
    return all.filter((g) => g.rows.length);
  }, [uniques, bases, sources, picked, sourceId, rarity, level, query]);

  return (
    <div className="browser">
      <GearRail options={options} tagNames={tagNames} selected={gear} onChange={setGear} anyLabel="All gear" />

      <div className="content">
        <div className="title-row">
          <h1>Uniques</h1>
          <span className="context">
            {gearLabel(options, gear)} / <span className="rar">{source?.name ?? 'All sources'}</span> / Lv {level}
          </span>
        </div>

        <div className="controls">
          <label className="field grow">
            <span className="cap">Search</span>
            <input className="in" type="search" placeholder="Name or stat" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <GearSelect options={options} selected={gear} onChange={setGear} anyLabel="All gear" />
          <Dropdown
            className="source"
            label="Source"
            value={sourceId}
            groups={[{ options: [{ value: '', label: 'All sources' }, ...sources.map((s) => ({ value: s.id, label: s.name }))] }]}
            onChange={setSourceId}
          />
          <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
        </div>

        {groups.length === 0 && <p className="empty">Nothing matches.</p>}
        {groups.map((group) => (
          <section key={`${group.id}/${gear}/${sourceId}`} className="group">
            <div className="group-head">
              <h2>{group.label}</h2>
              <span className="count">{group.rows.length}</span>
            </div>
            <div className="row unique head cap" aria-hidden="true">
              <span>Name</span>
              <span>Stats at lv {level}</span>
              <span className="pct">Drop lv</span>
              <span>Drops from</span>
            </div>
            <ul>
              {group.rows.map(({ unique, baseIndex, from, lines }) => (
                <li key={unique.id} className="row unique">
                  <div className="name">
                    {unique.name}
                    <span className="base">{bases[baseIndex].name}</span>
                  </div>
                  <div className="stats">
                    {lines.map((line, i) => (
                      <div key={i}>
                        <StatLine line={line} />
                      </div>
                    ))}
                  </div>
                  <span className="pct">{unique.source !== 'none' && `Lv ${unique.minLevel}`}</span>
                  <span className="tags">
                    {unique.source === 'any' ? (
                      !unique.minMapTier && from
                    ) : (
                      <span className={`tag ${unique.source === 'none' ? 'not' : ''}`}>{from}</span>
                    )}
                    {unique.minMapTier > 0 && <span className="tag">Map tier {unique.minMapTier}+</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

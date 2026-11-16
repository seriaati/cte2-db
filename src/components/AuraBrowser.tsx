import { useEffect, useMemo, useState } from 'react';
import { formatStat, type Rarity } from '../lib/affix';
import type { Aura } from '../lib/auras';
import { LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';
import { useStored } from '../lib/useStored';

interface Props {
  auras: Aura[];
  rarities: Rarity[];
  maxLevel: number;
}

const STYLES = ['STR', 'DEX', 'INT'];

export default function AuraBrowser({ auras, rarities, maxLevel }: Props) {
  const [query, setQuery] = useState('');
  const [style, setStyle] = useState('');
  const [rarityId, setRarityId] = useStored('rarity', rarities.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);

  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;

  // The header logo sits outside this component and picks up the rarity colour too.
  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = auras
      .filter((a) => !style || a.style === style)
      .map((aura) => ({ aura, lines: aura.stats.map((s) => formatStat(s, rarity, level)) }))
      .filter((r) => !q || [r.aura.name, ...r.lines.map((l) => `${l.value} ${l.label}`)].some((s) => s.toLowerCase().includes(q)));
    return [...new Set(rows.map((r) => r.aura.minLevel))].map((minLevel) => ({ minLevel, rows: rows.filter((r) => r.aura.minLevel === minLevel) }));
  }, [auras, style, rarity, level, query]);

  return (
    <div className="content">
      <div className="title-row">
        <h1>Augments</h1>
        <span className="context">
          <span className="rar">{rarity.name}</span> / Lv {level}
        </span>
      </div>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Name or stat" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="field">
          <span className="cap" id="style-label">
            Style
          </span>
          <div className="seg" role="group" aria-labelledby="style-label">
            {['', ...STYLES].map((s) => (
              <button key={s} className="btn" type="button" aria-pressed={style === s} onClick={() => setStyle(s)}>
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>
        <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
        <RaritySwatches rarities={rarities} value={rarityId} onChange={setRarityId} />
      </div>

      {groups.length === 0 && <p className="empty">Nothing matches.</p>}
      {groups.map((group) => (
        <section key={group.minLevel} className="group">
          <div className="group-head">
            <h2>Level {group.minLevel}</h2>
            <span className="count">{group.rows.length}</span>
            {group.minLevel > level && <span className="pool">Above your level</span>}
          </div>
          <div className="row aura head cap" aria-hidden="true">
            <span>Augment</span>
            <span>
              Stats at {rarity.name}, lv {level}
            </span>
            <span className="pct">Reserves</span>
          </div>
          <ul>
            {group.rows.map(({ aura, lines }) => (
              <li key={aura.id} className={`row aura ${aura.minLevel > level ? 'never' : ''}`}>
                <div className="name named">
                  <img className="sprite" src={aura.icon} alt={aura.style} width={32} height={32} />
                  {aura.name}
                </div>
                <div className="stats">
                  {lines.map((line, i) => (
                    <div key={i}>
                      <StatLine line={line} />
                    </div>
                  ))}
                </div>
                <span className="pct">
                  <span className="cap">Reserves</span> {aura.reserves}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

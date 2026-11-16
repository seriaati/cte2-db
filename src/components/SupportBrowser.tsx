import { useEffect, useMemo, useState } from 'react';
import { formatStat, type Rarity } from '../lib/affix';
import type { Support } from '../lib/supports';
import { useStored } from '../lib/useStored';
import { LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';

interface Props {
  supports: Support[];
  rarities: Rarity[];
  maxLevel: number;
}

const STYLES = ['STR', 'DEX', 'INT'];

export default function SupportBrowser({ supports, rarities, maxLevel }: Props) {
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
    const rows = supports
      .filter((s) => !style || s.style === style)
      .map((support) => ({ support, lines: support.stats.map((s) => formatStat(s, rarity, level)) }))
      .filter((r) => !q || [r.support.name, r.support.oneKind, ...r.lines.map((l) => `${l.value} ${l.label}`)].some((s) => s.toLowerCase().includes(q)));
    return [...new Set(rows.map((r) => r.support.minLevel))].map((minLevel) => ({ minLevel, rows: rows.filter((r) => r.support.minLevel === minLevel) }));
  }, [supports, style, rarity, level, query]);


  return (
    <div className="content">
      <div className="title-row">
        <h1>Support gems</h1>
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
          <div className="row support head cap" aria-hidden="true">
            <span>Support gem</span>
            <span>
              Stats at {rarity.name}, lv {level}
            </span>
            <span className="pct">Cost</span>
          </div>
          <ul>
            {group.rows.map(({ support, lines }) => (
              <li key={support.id} className={`row support ${support.minLevel > level ? 'never' : ''}`}>
                <div className="name named">
                  <img className="sprite" src={support.icon} alt={support.style} width={32} height={32} />
                  <span>
                    {support.name}
                    {support.oneKind && <span className="uses">Only one {support.oneKind} gem per skill</span>}
                  </span>
                </div>
                <div className="stats">
                  {lines.map((line, i) => (
                    <div key={i}>
                      <StatLine line={line} />
                    </div>
                  ))}
                </div>
                <span className="pct">
                  <span className="cap">Cost</span> {support.cost}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

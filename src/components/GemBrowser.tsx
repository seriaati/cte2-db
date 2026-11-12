import { useEffect, useState, type CSSProperties } from 'react';
import { formatStat } from '../lib/affix';
import type { Gem, GemRank } from '../lib/gems';
import { StatLine } from './StatLine';

interface Props {
  gems: Gem[];
  ranks: GemRank[];
  gemlessRarities: string[];
}

// The three stat lists a gem carries. Off-hand gear uses the armor one.
const KINDS = [
  { id: 'Weapon', label: 'Weapons' },
  { id: 'Armor', label: 'Armor, off-hand' },
  { id: 'Jewelry', label: 'Jewelry' },
] as const;

export default function GemBrowser({ gems, ranks, gemlessRarities }: Props) {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState(0);
  const [kindId, setKindId] = useState('');

  const rank = ranks[tier];
  const kinds = KINDS.filter((k) => !kindId || k.id === kindId);

  // The header logo sits outside this component and picks up the rarity colour too.
  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rank.rarity.ink);
  }, [rank]);

  const q = query.trim().toLowerCase();
  const rows = gems
    .filter((g) => g.tier === tier)
    // Gem values are fixed, so the rarity and level passed here change nothing.
    .map((gem) => ({ gem, cells: kinds.map((k) => gem.stats[k.id].map((s) => formatStat(s, rank.rarity, 1))) }))
    .filter((r) => !q || [r.gem.name, ...r.cells.flat().map((l) => `${l.value} ${l.label}`)].some((s) => s.toLowerCase().includes(q)));

  return (
    <div className="content">
      <div className="title-row">
        <h1>Gems</h1>
        <span className="context">
          <span className="rar">{rank.name}</span> / {kinds.length === 1 ? kinds[0].label : 'All gear'}
        </span>
      </div>
      <p className="lead">The gems you socket into gear in Craft to Exile 2, and what each one gives on a weapon, armor or jewelry.</p>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Name or stat" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="field">
          <span className="cap" id="rank-label">
            Rank
          </span>
          <div className="seg" role="group" aria-labelledby="rank-label">
            {ranks.map((r) => (
              <button key={r.tier} className="btn" type="button" aria-pressed={r.tier === tier} onClick={() => setTier(r.tier)}>
                {r.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="cap" id="kind-label">
            Socketed in
          </span>
          <div className="seg" role="group" aria-labelledby="kind-label">
            {[{ id: '', label: 'All gear' }, ...KINDS].map((k) => (
              <button key={k.id} className="btn" type="button" aria-pressed={kindId === k.id} onClick={() => setKindId(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="note">
        A gem goes into an empty socket and gives one stat, which depends on the kind of gear; off-hand items count as
        armor. The value is fixed: it doesn't roll and doesn't grow with level, so only the rank matters.{' '}
        {gemlessRarities.length > 0 && `${gemlessRarities.join(' and ')} gear takes no gems. `}
        Three gems of one rank craft into one of the next, except {ranks.at(-1)!.name}, which only drops from pinnacle
        bosses. A gem can drop once the monsters you fight reach its drop level, and each rank is rarer than the one
        before.
      </p>

      <section key={tier} className="group">
        <div className="group-head">
          <h2>{rank.name} gems</h2>
          <span className="count">{rows.length}</span>
        </div>
        <div className="row gem head cap" style={{ '--cols': kinds.length } as CSSProperties} aria-hidden="true">
          <span>Gem</span>
          {kinds.map((k) => (
            <span key={k.id}>{k.label}</span>
          ))}
          <span className="drop">Drop lv</span>
        </div>
        {rows.length === 0 && <p className="empty">Nothing matches.</p>}
        <ul>
          {rows.map(({ gem, cells }) => (
            <li key={gem.id} className="row gem" style={{ '--cols': kinds.length } as CSSProperties}>
              <div className="name named">
                <img className="sprite" src={gem.icon} alt="" width={32} height={32} />
                {gem.name}
              </div>
              {kinds.map((k, i) => (
                <div key={k.id} className="gem-stat">
                  <span className="cap">{k.label}</span>
                  {cells[i].map((line, j) => (
                    <div key={j}>
                      <StatLine line={line} />
                    </div>
                  ))}
                </div>
              ))}
              <span className="drop">
                {gem.drops ? <span className="pct">Lv {Math.max(gem.dropLevel, 1)}</span> : <span className="tag">Pinnacle bosses</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

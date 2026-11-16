import { useMemo, useState } from 'react';
import type { Stat } from '../lib/stats';
import { useQuery } from '../lib/useQuery';
import { Dropdown } from './controls';

interface Props {
  stats: Stat[];
  sourceNames: string[];
}

export default function StatBrowser({ stats, sourceNames }: Props) {
  const [query, setQuery] = useQuery();
  const [source, setSource] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stats.filter(
      (s) =>
        (!source || (source === 'none' ? !s.sources.length : s.sources.includes(source))) &&
        (!q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)),
    );
  }, [stats, source, query]);

  return (
    <div className="content">
      <div className="title-row">
        <h1>Stats</h1>
        <span className="context">
          {source === 'none' ? 'Not listed' : source || 'All stats'} / {rows.length}
        </span>
      </div>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Name or description" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Dropdown
          className="found"
          label="Found on"
          value={source}
          groups={[
            { options: [{ value: '', label: 'All stats' }] },
            { options: sourceNames.map((name) => ({ value: name, label: name })) },
            { options: [{ value: 'none', label: 'Not listed' }] },
          ]}
          onChange={setSource}
        />
      </div>

      {rows.length === 0 ? (
        <p className="empty">Nothing matches.</p>
      ) : (
        <section className="group">
          <div className="row stat head cap" aria-hidden="true">
            <span>Stat</span>
            <span>What it does</span>
            <span>Found on</span>
          </div>
          <ul>
            {rows.map((stat) => (
              <li key={`${stat.name}\n${stat.desc}`} className="row stat">
                <span className="name">{stat.name}</span>
                <span className="desc">{stat.desc}</span>
                <span className="tags">
                  {stat.sources.map((s) => (
                    <span key={s} className="tag">
                      {s}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

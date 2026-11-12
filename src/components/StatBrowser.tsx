import { useMemo, useState } from 'react';
import type { Stat } from '../lib/stats';
import { Dropdown } from './controls';

interface Props {
  stats: Stat[];
  sourceNames: string[];
}

export default function StatBrowser({ stats, sourceNames }: Props) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = stats.filter(
      (s) =>
        (!source || (source === 'none' ? !s.sources.length : s.sources.includes(source))) &&
        (!q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)),
    );
    return [
      { label: 'On gear', rows: rows.filter((s) => s.sources.length) },
      { label: 'Other stats', rows: rows.filter((s) => !s.sources.length) },
    ].filter((g) => g.rows.length);
  }, [stats, source, query]);

  return (
    <div className="content">
      <div className="title-row">
        <h1>Stats</h1>
        <span className="context">{source === 'none' ? 'Not listed' : source || 'All stats'}</span>
      </div>
      <p className="lead">Every stat in Craft to Exile 2, what it does, and which lists on this site it shows up in.</p>

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

      <p className="note">
        Descriptions are the game's own. Stats under Other come from parts of the game this site doesn't list yet, such
        as talents, spells, jewels and maps. An X in a name stands for the stat's value.
      </p>

      {groups.length === 0 && <p className="empty">Nothing matches.</p>}
      {groups.map((group) => (
        <section key={group.label} className="group">
          <div className="group-head">
            <h2>{group.label}</h2>
            <span className="count">{group.rows.length}</span>
          </div>
          <div className="row stat head cap" aria-hidden="true">
            <span>Stat</span>
            <span>What it does</span>
            <span>Found on</span>
          </div>
          <ul>
            {group.rows.map((stat) => (
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
      ))}
    </div>
  );
}

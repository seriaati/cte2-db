import { useState } from 'react';
import { statGroups, totalLines } from '../../lib/buildCalc';
import type { Build } from '../../lib/buildRules';
import { StatLine } from '../StatLine';
import { Info, Loading, type TabProps } from './shared';
import { useTotals } from './totals';

// What the build's stats come to: the numbers that matter most, then the rest in the game's own groups.
function StatTotals({ build }: { build: Build }) {
  const totals = useTotals(build);
  const [search, setSearch] = useState('');
  if (!totals) return <Loading />;

  const { rules, stats, skipped } = totals;
  const query = search.trim().toLowerCase();
  const groups = statGroups(totals)
    .map((group) => ({ name: group.name, rows: group.rows.filter((line) => `${line.value} ${line.label}`.toLowerCase().includes(query)) }))
    .filter((group) => group.rows.length);

  return (
    <>
      {skipped.map((reason) => (
        <p key={reason} className="note skipped">
          {reason}
        </p>
      ))}

      <dl className="totals-main">
        {rules.main.map((id) => {
          const def = rules.defs[id];
          const value = stats.get(id)?.value ?? def.base;
          return (
            <div key={id}>
              <dt className="cap">{def.name}</dt>
              <dd>{totalLines(id, def, { value, more: 1 })[0].value.replace('+', '')}</dd>
            </div>
          );
        })}
      </dl>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Stat" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {groups.length === 0 && <p className="empty">Nothing matches.</p>}
      {groups.map((group) => (
        <section key={group.name} className="group">
          <div className="group-head">
            <h2>{group.name}</h2>
          </div>
          <ul className="totals">
            {group.rows.map((line, i) => (
              <li key={i}>
                <StatLine line={line} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function CalculatorTab({ build }: TabProps) {
  return (
    <div className="plain">
      <div className="title-row">
        <h1>Stats</h1>
        <Info>
          <p>
            The stats of the whole build at level {build.level}, added up the way the game does it. Support gems only count for their own skill and are left out, and so are buffs, food and
            what vanilla armor and attributes give.
          </p>
        </Info>
      </div>
      <StatTotals build={build} />
    </div>
  );
}

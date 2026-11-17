import { useState } from 'react';
import { formatRange, type StatMod } from '../../lib/affix';
import type { Build } from '../../lib/buildRules';
import type { StatDef, Total } from '../../lib/statRules';
import { StatLine } from '../StatLine';
import { Loading, type TabProps } from './shared';
import { useTotals } from './totals';

// A total written the way the site writes any stat. A damage stat's "more" multipliers get a line of their own.
function lines(id: string, def: StatDef, total: Total) {
  const mod: StatMod = { id, name: def.name, desc: '', type: 'FLAT', min: 0, max: 0, percent: def.percent, long: def.long, scaling: null };
  const more = (total.more - 1) * 100;
  return [...(total.value !== 0 || more === 0 ? [formatRange(mod, total.value, total.value)] : []), ...(more !== 0 ? [formatRange({ ...mod, type: 'MORE' }, more, more)] : [])];
}

// What the build's stats come to: the numbers that matter most, then the rest in the game's own groups.
function StatTotals({ build }: { build: Build }) {
  const totals = useTotals(build);
  const [search, setSearch] = useState('');
  if (!totals) return <Loading />;

  const { rules, stats, skipped } = totals;
  const query = search.trim().toLowerCase();
  const listed = new Set([...rules.main, ...rules.groups.flatMap((group) => group.ids)]);
  // Like the game's own list, the rest leaves out stats that read as a sentence: what they do is already in the numbers.
  const others = [...stats.keys()].filter((id) => !listed.has(id) && !rules.defs[id].hidden && !rules.defs[id].long).sort((a, b) => rules.defs[a].name.localeCompare(rules.defs[b].name));
  const groups = [...rules.groups, { name: 'Other', ids: others }]
    .map((group) => ({
      name: group.name,
      rows: group.ids.flatMap((id) => {
        const total = stats.get(id);
        // A stat nothing has touched isn't there, and one that came to nothing isn't worth a line.
        if (!total || (total.value === 0 && total.more === 1)) return [];
        return lines(id, rules.defs[id], total).filter((line) => `${line.value} ${line.label}`.toLowerCase().includes(query));
      }),
    }))
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
              <dd>{lines(id, def, { value, more: 1 })[0].value.replace('+', '')}</dd>
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
      </div>
      <p className="note">
        The stats of the whole build at level {build.level}, added up the way the game does it. Support gems only count for their own skill and are left out, and so are buffs, food and
        what vanilla armor and attributes give.
      </p>
      <StatTotals build={build} />
    </div>
  );
}

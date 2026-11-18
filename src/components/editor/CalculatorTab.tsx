import { useEffect, useRef, useState } from 'react';
import { statGroups, statSources, totalLines, type Totals } from '../../lib/buildCalc';
import type { Build } from '../../lib/buildRules';
import { StatLine } from '../StatLine';
import { Info, Loading, type TabProps } from './shared';
import { useTotals } from './totals';

const num = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en') : `${+n.toFixed(2)}`);
const signed = (n: number, unit = '') => `${n < 0 ? '−' : '+'}${num(Math.abs(n))}${unit}`;
const KINDS = { FLAT: 'Added', PERCENT: 'Increased', MORE: 'More' } as const;

// How one stat's total was worked out: the sum, then what each part of the build gave to it.
function Breakdown({ totals, id, onClose }: { totals: Totals; id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current!.showModal(), []);
  const def = totals.rules.defs[id];
  const { sum, derived, total, kinds } = statSources(totals, id);
  const unit = def.percent ? '%' : '';
  const value = (type: keyof typeof KINDS, n: number) => (type === 'MORE' ? `${num(Math.abs(n))}% ${n < 0 ? 'less' : 'more'}` : signed(n, type === 'PERCENT' ? '%' : unit));
  const reached = (sum?.value ?? 0) + derived.reduce((all, d) => all + d.value, 0);
  const limit = reached > def.max ? `held to its most, ${num(def.max)}${unit}` : reached < def.min ? `held to its least, ${num(def.min)}${unit}` : '';
  const multipliers = sum ? [1 + sum.percent / 100, def.apart ? 1 : sum.more].filter((m) => m !== 1) : [];
  const added = sum ? (sum.flat ? `${num(sum.base)}${unit} base ${signed(sum.flat, unit)}` : `${num(sum.base)}${unit} base`) : '';

  return (
    <dialog ref={dialog} className="search breakdown" aria-label={def.name} onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
      <form method="dialog">
        <h2>{def.name}</h2>
        <button className="btn" aria-label="Close">
          ×
        </button>
      </form>
      <div className="breakdown-body">
        <p className="formula">
          {sum ? (
            <>
              {multipliers.length && sum.flat ? `(${added})` : added}
              {multipliers.map((m) => ` × ${+m.toFixed(3)}`).join('')}
              {(multipliers.length > 0 || sum.flat !== 0) && ` = ${num(sum.value)}${unit}`}
            </>
          ) : (
            !derived.length && `${num(total.value)}${unit}, its base: nothing in the build changes it.`
          )}
          {derived.map((d) => (
            <span key={d.from}> {signed(d.value, unit)}</span>
          ))}
          {derived.length > 0 && <> = {num(reached)}{unit}</>}
          {limit && <>, {limit}</>}
          {def.apart && total.more !== 1 && <span className="line">Its {num((total.more - 1) * 100)}% more is kept apart and multiplies the damage it deals.</span>}
        </p>
        {kinds.map(
          ({ type, rows }) =>
            rows.length > 0 && (
              <section key={type}>
                <h3 className="cap">{KINDS[type]}</h3>
                <ul className="totals one">
                  {rows.map((row) => (
                    <li key={row.from}>
                      <span>{row.from}</span>
                      <span className="v">{value(type, row.value)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )}
        {derived.length > 0 && (
          <section>
            <h3 className="cap">From other stats, after the rest</h3>
            <ul className="totals one">
              {derived.map((d) => (
                <li key={d.from}>
                  <span>{d.from}</span>
                  <span className="v">{signed(d.value, unit)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </dialog>
  );
}

// What the build's stats come to: the numbers that matter most, then the rest in the game's own groups.
function StatTotals({ build }: { build: Build }) {
  const totals = useTotals(build);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
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
              <dt className="cap">
                {/* Stretched over the whole box, so all of it opens the breakdown. */}
                <button type="button" className="stat-open" onClick={() => setOpen(id)}>
                  {def.name}
                </button>
              </dt>
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
                <button type="button" className="stat-open" onClick={() => setOpen(line.id)}>
                  <StatLine line={line} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open && <Breakdown totals={totals} id={open} onClose={() => setOpen(null)} />}
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
            The stats of the whole build at level {build.level}, added up the way the game does it. Support gems only count for their own skill and are left out, and so are food and what
            vanilla armor and attributes give. Of buffs, the ones set to be on under Damage or Defense count: Retribution stacks, an aura, and the effects that skills and stats give.
          </p>
          <p>Click a stat to see how it was worked out and what in the build gave it.</p>
        </Info>
      </div>
      <StatTotals build={build} />
    </div>
  );
}

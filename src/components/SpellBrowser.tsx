import { useMemo, useState } from 'react';
import type { StatMod } from '../lib/affix';
import type { Link } from '../lib/effects';
import { calcText, cost, spellStat, type Spell } from '../lib/spellRules';
import { useQuery } from '../lib/useQuery';
import { useStored } from '../lib/useStored';
import { Dropdown, LevelStepper } from './controls';
import { LinkTags } from './LinkTags';
import { StatLine } from './StatLine';

interface Props {
  spells: Spell[];
  // The status effects each spell gives, by spell id.
  effects: Record<string, Link[]>;
  classIcons: Record<string, string>;
  bonusLevels: number;
  costScaling: NonNullable<StatMod['scaling']>;
  maxLevel: number;
}

export default function SpellBrowser({ spells, effects, classIcons, bonusLevels, costScaling, maxLevel }: Props) {
  const [query, setQuery] = useQuery();
  const [school, setSchool] = useState('');
  const [level, setLevel] = useStored('level', maxLevel);
  const [rankId, setRankId] = useState('Max');

  const schools = [...new Set(spells.map((s) => s.school))];

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = spells
      .filter((s) => !school || s.school === school)
      .map((spell) => {
        const top = spell.maxLevel + bonusLevels;
        const rank = rankId === '1' ? 1 : rankId === 'Max' ? spell.maxLevel : top;
        // Odd pieces are the ids of the description's [calc:id] placeholders.
        const fill = (desc: string) => desc.split(/\[calc:(\w+)\]/).map((piece, i) => (i % 2 ? calcText(spell.calcs[piece], rank, top, level) : piece));
        return {
          spell,
          desc: fill(spell.desc),
          linked: spell.linked && fill(spell.linked.desc),
          costs: (['Mana', 'Energy'] as const)
            .map((label) => [label, cost(spell, label === 'Mana' ? 'mana' : 'energy', rank, top, costScaling, level)] as const)
            .filter(([, value]) => value > 0),
          lines: spell.stats.map((s) => spellStat(s, rank, top, level)),
        };
      })
      .filter(
        (r) =>
          !q ||
          [r.spell.name, r.spell.linked?.name ?? '', r.desc.join(''), r.linked?.join('') ?? '', ...r.spell.tags, ...r.lines.map((l) => `${l.value} ${l.label}`)].some((s) =>
            s.toLowerCase().includes(q),
          ),
      );
    return [...new Set(rows.map((r) => r.spell.school))].map((name) => ({ name, rows: rows.filter((r) => r.spell.school === name) }));
  }, [spells, bonusLevels, costScaling, school, level, rankId, query]);

  const text = (pieces: string[]) =>
    pieces.map((piece, i) =>
      i % 2 ? (
        <span key={i} className="v">
          {piece}
        </span>
      ) : (
        piece
      ),
    );

  return (
    <div className="content plain">
      <div className="title-row">
        <h1>Spells</h1>
        <span className="context">
          {school || 'All classes'} / Lv {level}
        </span>
      </div>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Name, effect or tag" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Dropdown
          className="class"
          label="Class"
          value={school}
          groups={[{ options: [{ value: '', label: 'All classes' }, ...schools.map((s) => ({ value: s, label: s, icon: classIcons[s] }))] }]}
          onChange={setSchool}
        />
        <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
        <div className="field">
          <span className="cap" id="rank-label">
            Spell level
          </span>
          <div className="seg" role="group" aria-labelledby="rank-label">
            {['1', 'Max', `Max +${bonusLevels}`].map((r) => (
              <button key={r} className="btn" type="button" aria-pressed={rankId === r} onClick={() => setRankId(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {groups.length === 0 && <p className="empty">Nothing matches.</p>}
      {groups.map((group) => (
        <section key={group.name} className="group">
          <div className="group-head">
            <img src={classIcons[group.name]} alt="" width={36} height={36} />
            <h2>{group.name}</h2>
            <span className="count">{group.rows.length}</span>
          </div>
          <div className="row spell head cap" aria-hidden="true">
            <span>Spell</span>
            <span>
              Effect at spell level {rankId.toLowerCase()}, lv {level}
            </span>
            <span>Cost and timing</span>
          </div>
          <ul>
            {group.rows.map(({ spell, desc, linked, costs, lines }) => (
              <li key={spell.id} className={`row spell ${spell.level > level ? 'never' : ''}`}>
                <div className="name named">
                  <img className="sprite" src={spell.icon} alt="" width={32} height={32} />
                  <span>
                    {spell.name}
                    <span className="uses">Requires level {spell.level}</span>
                    <span className="uses">Max level {spell.maxLevel}</span>
                  </span>
                </div>
                <div className="stats">
                  <p>{text(desc)}</p>
                  {linked && (
                    <p>
                      <strong>{spell.linked!.name}</strong>: {text(linked)}
                    </p>
                  )}
                  {lines.map((line, i) => (
                    <div key={i}>
                      <StatLine line={line} />
                    </div>
                  ))}
                  <LinkTags label="Applies" links={effects[spell.id] ?? []} />
                  <div className="tags">
                    {spell.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <dl className="facts">
                  {[...costs, ...spell.facts].map(([label, value]) => (
                    <div key={label}>
                      <dt className="cap">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

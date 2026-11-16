import { useMemo, useState } from 'react';
import { formatRange, rolled } from '../lib/affix';
import type { Effect } from '../lib/effects';
import { useQuery } from '../lib/useQuery';
import { useStored } from '../lib/useStored';
import { Dropdown, LevelStepper } from './controls';
import { LinkTags } from './LinkTags';
import { StatLine } from './StatLine';

interface Props {
  effects: Effect[];
  tags: string[];
  maxLevel: number;
}

const TYPES = [
  { id: 'beneficial', label: 'Buffs' },
  { id: 'negative', label: 'Debuffs' },
];

export default function EffectBrowser({ effects, tags, maxLevel }: Props) {
  const [query, setQuery] = useQuery();
  const [type, setType] = useState('');
  const [tag, setTag] = useState('');
  const [level, setLevel] = useStored('level', maxLevel);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = effects
      .filter((e) => (!type || e.type === type) && (!tag || e.tags.includes(tag)))
      // ExileEffect.getExactStats in Mine and Slash: a stat goes from its min to its max with the level of the spell that gave the effect.
      .map((effect) => ({ effect, lines: [...effect.stats.map((s) => formatRange(s, rolled(s, 0, level), rolled(s, 100, level))), ...effect.vanilla] }))
      .filter(
        (r) =>
          !q ||
          [r.effect.name, r.effect.desc, r.effect.oneKind, ...r.effect.tags, ...r.lines.map((l) => `${l.value} ${l.label}`)].some((s) => s.toLowerCase().includes(q)),
      );
    return TYPES.map((t) => ({ ...t, rows: rows.filter((r) => r.effect.type === t.id) })).filter((g) => g.rows.length);
  }, [effects, type, tag, level, query]);

  return (
    <div className="content plain">
      <div className="title-row">
        <h1>Status effects</h1>
        <span className="context">
          {tag || 'Any tag'} / Lv {level}
        </span>
      </div>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Name, stat or tag" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="field">
          <span className="cap" id="type-label">
            Type
          </span>
          <div className="seg" role="group" aria-labelledby="type-label">
            {[{ id: '', label: 'All' }, ...TYPES].map((t) => (
              <button key={t.id} className="btn" type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <Dropdown
          className="with-tag"
          label="Tag"
          value={tag}
          groups={[{ options: [{ value: '', label: 'Any tag' }, ...tags.map((t) => ({ value: t, label: t }))] }]}
          onChange={setTag}
        />
        <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
      </div>

      {groups.length === 0 && <p className="empty">Nothing matches.</p>}
      {groups.map((group) => (
        <section key={group.id} className="group">
          <div className="group-head">
            <h2>{group.label}</h2>
            <span className="count">{group.rows.length}</span>
          </div>
          <div className="row effect head cap" aria-hidden="true">
            <span>Effect</span>
            <span>Stats per stack at lv {level}</span>
            <span className="pct">Stacks</span>
            <span>Tags</span>
          </div>
          <ul>
            {group.rows.map(({ effect, lines }) => (
              <li key={effect.id} className={`row effect ${effect.applied ? '' : 'never'}`}>
                <div className="name named">
                  {effect.icon ? <img className="sprite" src={effect.icon} alt="" width={32} height={32} /> : <span className="sprite" />}
                  <span>
                    {effect.name}
                    {effect.oneKind && <span className="uses">One {effect.oneKind} at a time</span>}
                  </span>
                </div>
                <div className="stats">
                  {lines.map((line, i) => (
                    <div key={i}>
                      <StatLine line={line} />
                    </div>
                  ))}
                  {effect.desc && <div>{effect.desc}</div>}
                  <LinkTags label="From" links={effect.from} />
                </div>
                <span className="pct">
                  <span className="cap">Stacks</span> {effect.maxStacks}
                </span>
                <span className="tags">
                  {effect.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                  {!effect.applied && <span className="tag not">Not applied in this pack</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

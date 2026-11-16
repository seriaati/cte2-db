import { useEffect, useMemo, useState } from 'react';
import { canRoll, formatStat, type Affix, type Base, type Rarity } from '../lib/affix';
import { gearLabel, gearOptions, GearRail, GearSelect, LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';
import { useStored } from '../lib/useStored';

interface Props {
  affixes: Affix[];
  bases: Base[];
  rarities: Rarity[];
  tagNames: Record<string, string>;
  maxLevel: number;
}

const TYPES = [
  { id: 'prefix', label: 'Prefixes' },
  { id: 'suffix', label: 'Suffixes' },
  { id: 'implicit', label: 'Implicits' },
] as const;

export default function AffixBrowser({ affixes, bases, rarities, tagNames, maxLevel }: Props) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<Affix['type'] | 'all'>('all');
  const [gear, setGear] = useState<string[]>([]);
  const [rarityId, setRarityId] = useStored('rarity', rarities.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);

  const options = useMemo(
    () => gearOptions(bases, tagNames, (b) => affixes.filter((a) => canRoll(a, b)).map((a) => a.id).join()),
    [bases, tagNames, affixes],
  );
  const picked = useMemo(() => options.filter((o) => gear.includes(o.id)).flatMap((o) => o.bases), [options, gear]);
  // The odds of an affix only mean something on one piece of gear.
  const base = picked.length === 1 ? picked[0] : undefined;
  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;

  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TYPES.filter((t) => type === 'all' || type === t.id).map((t) => {
      const pool = affixes.filter((a) => a.type === t.id && (!picked.length || picked.some((b) => canRoll(a, b))));
      // Implicits roll across their whole range whatever the rarity.
      const roll = t.id === 'implicit' ? { ...rarity, minPercent: 0, maxPercent: 100 } : rarity;
      const totalWeight = pool.reduce((sum, a) => sum + a.weight, 0);
      const rows = pool
        .map((affix) => ({
          affix,
          lines: affix.stats.map((s) => formatStat(s, roll, level)),
          chance: affix.weight / totalWeight,
        }))
        .filter((r) => !q || [r.affix.name, ...r.lines.map((l) => `${l.value} ${l.label}`)].some((s) => s.toLowerCase().includes(q)))
        .sort((a, b) => (base ? b.chance - a.chance : 0) || a.affix.name.localeCompare(b.affix.name));
      return { ...t, rows };
    });
  }, [affixes, picked, base, rarity, level, type, query]);

  return (
    <div className="browser">
      <GearRail options={options} tagNames={tagNames} selected={gear} onChange={setGear} anyLabel="All gear" />

      <div className="content">
        <div className="title-row">
          <h1>Affixes</h1>
          <span className="context">
            {gearLabel(options, gear)} / <span className="rar">{rarity.name}</span> / Lv {level}
          </span>
        </div>

        <div className="controls">
          <label className="field grow">
            <span className="cap">Search</span>
            <input className="in" type="search" placeholder="Name or stat" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <GearSelect options={options} selected={gear} onChange={setGear} anyLabel="All gear" />
          <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
          <RaritySwatches rarities={rarities} value={rarityId} onChange={setRarityId} />
          <div className="field">
            <span className="cap" id="show-label">
              Show
            </span>
            <div className="seg" role="group" aria-labelledby="show-label">
              {[{ id: 'all', label: 'All' } as const, ...TYPES].map((t) => (
                <button key={t.id} className="btn" type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {groups.map((group) => (
          <section key={`${group.id}/${gear}`} className="group">
            <div className="group-head">
              <h2>{group.label}</h2>
              <span className="count">{group.rows.length}</span>
            </div>
            <div className={`row head cap ${base ? '' : 'wide'}`} aria-hidden="true">
              <span>Name</span>
              <span>
                {group.id === 'implicit' ? `Rolls at lv ${level}` : `Rolls at ${rarity.name} tier, lv ${level}`}
              </span>
              {base ? <span className="pct">Chance</span> : <span>Rolls on</span>}
            </div>
            {group.rows.length === 0 && <p className="empty">Nothing matches.</p>}
            <ul>
              {group.rows.map(({ affix, lines, chance }) => (
                <li key={affix.id} className={`row ${base ? '' : 'wide'} ${affix.weight ? '' : 'never'} ${group.id === 'implicit' ? 'plain' : ''}`}>
                  <span className="name">{affix.name}</span>
                  <div className="stats">
                    {lines.map((line, i) => (
                      <div key={i}>
                        <StatLine line={line} />
                      </div>
                    ))}
                  </div>
                  {base ? (
                    <span className="pct">{chance ? `${(chance * 100).toFixed(1)}%` : '0%'}</span>
                  ) : (
                    <span className="tags">
                      {affix.included
                        .filter((t) => t in tagNames)
                        .map((t) => (
                          <span key={t} className="tag">
                            {tagNames[t]}
                          </span>
                        ))}
                      {affix.excluded
                        .filter((t) => t in tagNames)
                        .map((t) => (
                          <span key={t} className="tag not">
                            not {tagNames[t]}
                          </span>
                        ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

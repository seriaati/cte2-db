import { useEffect, useMemo, useState } from 'react';
import { canRoll, formatStat, type Affix, type Base, type Rarity } from '../lib/affix';
import { useStored } from '../lib/useStored';
import { gearLabel, gearOptions, GearRail, GearSelect, LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';

interface Props {
  infusions: Affix[];
  bases: Base[];
  rarities: Rarity[];
  tagNames: Record<string, string>;
  maxLevel: number;
}

export default function InfusionBrowser({ infusions, bases, rarities, tagNames, maxLevel }: Props) {
  const [query, setQuery] = useState('');
  const [gear, setGear] = useState<string[]>([]);
  const [rarityId, setRarityId] = useStored('rarity', rarities.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);

  const options = useMemo(
    () => gearOptions(bases, tagNames, (b) => infusions.filter((a) => canRoll(a, b)).map((a) => a.id).join()),
    [bases, tagNames, infusions],
  );
  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;

  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // GearInfusionData.getPercent: an infusion doesn't roll, it sits at the top of its rarity's range.
    const fixed = { ...rarity, minPercent: rarity.maxPercent };
    return options
      .filter((o) => !gear.length || gear.includes(o.id))
      .map((o) => {
        const pool = infusions.filter((a) => canRoll(a, o.bases[0]));
        const totalWeight = pool.reduce((sum, a) => sum + a.weight, 0);
        const rows = pool
          .map((affix) => ({ affix, lines: affix.stats.map((s) => formatStat(s, fixed, level)), chance: affix.weight / totalWeight }))
          .filter((r) => !q || r.lines.some((l) => `${l.value} ${l.label}`.toLowerCase().includes(q)));
        return { label: o.name, rows };
      })
      .filter((g) => g.rows.length);
  }, [infusions, options, gear, rarity, level, query]);

  return (
    <div className="browser">
      <GearRail options={options} tagNames={tagNames} selected={gear} onChange={setGear} anyLabel="All gear" />

      <div className="content">
        <div className="title-row">
          <h1>Infusions</h1>
          <span className="context">
            {gearLabel(options, gear)} / <span className="rar">{rarity.name}</span> / Lv {level}
          </span>
        </div>

        <div className="controls">
          <label className="field grow">
            <span className="cap">Search</span>
            <input className="in" type="search" placeholder="Stat" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <GearSelect options={options} selected={gear} onChange={setGear} anyLabel="All gear" />
          <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
          <RaritySwatches rarities={rarities} value={rarityId} onChange={setRarityId} />
        </div>

        {groups.length === 0 && <p className="empty">Nothing matches.</p>}
        {groups.map((group) => (
          <section key={group.label} className="group">
            <div className="group-head">
              <h2>{group.label}</h2>
              <span className="count">{group.rows.length}</span>
            </div>
            <div className="row infusion head cap" aria-hidden="true">
              <span>
                Gives at {rarity.name}, lv {level}
              </span>
              <span className="pct">Chance</span>
            </div>
            <ul>
              {group.rows.map(({ affix, lines, chance }) => (
                <li key={affix.id} className="row infusion">
                  <div className="stats">
                    {lines.map((line, i) => (
                      <div key={i}>
                        <StatLine line={line} />
                      </div>
                    ))}
                  </div>
                  <span className="pct">{(chance * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

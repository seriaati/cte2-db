import { useEffect, useMemo, useState } from 'react';
import { canRoll, formatStat, type Affix, type Base, type Rarity } from '../lib/affix';
import { useStored } from '../lib/useStored';
import { GearRail, GearSelect, LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';

interface Props {
  infusions: Affix[];
  bases: Base[];
  rarities: Rarity[];
  tagNames: Record<string, string>;
  maxLevel: number;
}

// Each infusion names the one gear tag it fits, in the order gear is listed elsewhere.
const FITS = ['weapon_family', 'offhand_family', 'helmet', 'chest', 'pants', 'boots', 'necklace', 'ring'];
const FIT_NAMES: Record<string, string> = { weapon_family: 'Weapons', offhand_family: 'Off-hand' };

export default function InfusionBrowser({ infusions, bases, rarities, tagNames, maxLevel }: Props) {
  const [query, setQuery] = useState('');
  const [baseId, setBaseId] = useState('');
  const [rarityId, setRarityId] = useStored('rarity', rarities.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);

  const base = bases.find((b) => b.id === baseId);
  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;

  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    // GearInfusionData.getPercent: an infusion doesn't roll, it sits at the top of its rarity's range.
    const fixed = { ...rarity, minPercent: rarity.maxPercent };
    const pool = infusions.filter((a) => !base || canRoll(a, base));
    const totalWeight = pool.reduce((sum, a) => sum + a.weight, 0);
    const rows = pool
      .map((affix) => ({ affix, lines: affix.stats.map((s) => formatStat(s, fixed, level)), chance: affix.weight / totalWeight }))
      .filter((r) => !q || r.lines.some((l) => `${l.value} ${l.label}`.toLowerCase().includes(q)));
    if (base) return rows.length || q ? [{ label: `On ${base.name}`, rows }] : [];
    return FITS.map((tag) => ({ label: FIT_NAMES[tag] ?? tagNames[tag], rows: rows.filter((r) => r.affix.included.includes(tag)) })).filter(
      (g) => g.rows.length,
    );
  }, [infusions, base, rarity, level, query]);

  return (
    <div className="browser">
      <GearRail bases={bases} tagNames={tagNames} value={baseId} onChange={setBaseId} anyLabel="All gear" />

      <div className="content">
        <div className="title-row">
          <h1>Infusions</h1>
          <span className="context">
            {base?.name ?? 'All gear'} / <span className="rar">{rarity.name}</span> / Lv {level}
          </span>
        </div>
        <p className="lead">The extra stat an Infusion scroll adds to a piece of gear, on top of its affixes.</p>

        <div className="controls">
          <label className="field grow">
            <span className="cap">Search</span>
            <input className="in" type="search" placeholder="Stat" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <GearSelect bases={bases} value={baseId} onChange={setBaseId} anyLabel="All gear" />
          <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
          <RaritySwatches rarities={rarities} value={rarityId} onChange={setRarityId} />
        </div>

        <p className="note">
          Infusion scrolls come from the Infusing profession, one kind each for weapons, off-hand, armor and jewelry.
          The first success gives the item one of the infusions below at random; after that each success raises its
          rarity one step, so it has to go Common, Uncommon and so on in order. An attempt works half the time and an
          item only gets ten attempts. The value doesn't roll: it is fixed by the infusion's rarity and the gear's
          level.
        </p>

        {groups.length === 0 && <p className="empty">{base && !query ? `No infusions fit ${base.name}.` : 'Nothing matches.'}</p>}
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
              {base && <span className="pct">Chance</span>}
            </div>
            {group.rows.length === 0 && <p className="empty">Nothing matches.</p>}
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
                  {base && <span className="pct">{(chance * 100).toFixed(1)}%</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

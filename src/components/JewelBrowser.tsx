import { useEffect, useMemo, useState } from 'react';
import { formatStat, type Rarity } from '../lib/affix';
import type { JewelAffix, JewelItem, JewelKind } from '../lib/jewels';
import { useStored } from '../lib/useStored';
import { LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';

interface Props {
  kinds: JewelKind[];
  crafted: JewelItem;
  eye: JewelItem;
  affixes: Record<'jewel' | 'corruption' | 'crafted' | 'eye', JewelAffix[]>;
  rarities: Rarity[];
  maxLevel: number;
}

const short = (item: JewelItem) => item.name.replace(' Jewel', '');

export default function JewelBrowser({ kinds, crafted, eye, affixes, rarities, maxLevel }: Props) {
  const [query, setQuery] = useState('');
  const [kindId, setKindId] = useState('');
  const [rarityId, setRarityId] = useStored('rarity', rarities.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);

  const kind = kinds.find((k) => k.id === kindId);
  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;

  // The header logo sits outside this component and picks up the rarity colour too.
  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (pool: JewelAffix[], rolls: Rarity) => {
      const totalWeight = pool.reduce((sum, a) => sum + a.weight, 0);
      return pool
        .map((affix) => ({ affix, lines: affix.stats.map((s) => formatStat(s, rolls, level)), chance: affix.weight / totalWeight }))
        .filter((r) => !q || [r.affix.aura, ...r.lines.map((l) => `${l.value} ${l.label}`)].some((s) => s.toLowerCase().includes(q)));
    };
    const tier = `Rolls at ${rarity.name} tier, lv ${level}`;
    const all: { id: string; title: string; icons: JewelItem[]; head: string; rows: ReturnType<typeof rows> }[] = [
      {
        id: 'jewel',
        title: 'Affixes',
        icons: kind ? [kind] : kinds,
        head: tier,
        rows: rows(affixes.jewel.filter((a) => !kind || a.tags.includes('any_jewel') || a.tags.includes(kind.tag)), rarity),
      },
      {
        id: 'corruption',
        title: 'Corruption',
        icons: [],
        head: tier,
        rows: rows(affixes.corruption, rarity),
      },
      {
        id: 'crafted',
        title: 'Crafted unique',
        icons: [crafted],
        head: tier,
        rows: rows(affixes.crafted, rarity),
      },
      {
        id: 'eye',
        title: 'Abyssal Eye',
        icons: [eye],
        head: `Rolls at lv ${level}`,
        rows: rows(affixes.eye, { ...rarity, minPercent: 0, maxPercent: 100 }),
      },
    ];
    return q ? all.filter((g) => g.rows.length) : all;
  }, [affixes, kinds, crafted, eye, kind, rarity, level, query]);

  return (
    <div className="content">
      <div className="title-row">
        <h1>Jewels</h1>
        <span className="context">
          {kind?.name ?? 'All jewels'} / <span className="rar">{rarity.name}</span> / Lv {level}
        </span>
      </div>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Stat or augment" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="field">
          <span className="cap" id="jewel-label">
            Jewel
          </span>
          <div className="seg" role="group" aria-labelledby="jewel-label">
            <button className="btn" type="button" aria-pressed={!kind} onClick={() => setKindId('')}>
              All
            </button>
            {kinds.map((k) => (
              <button key={k.id} className="btn" type="button" aria-pressed={k.id === kindId} onClick={() => setKindId(k.id)}>
                {short(k)}
              </button>
            ))}
          </div>
        </div>
        <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
        <RaritySwatches rarities={rarities} value={rarityId} onChange={setRarityId} />
      </div>

      {groups.length === 0 && <p className="empty">Nothing matches.</p>}
      {groups.map((group) => {
        const named = group.id === 'eye';
        const rollsOn = group.id === 'jewel' && !kind;
        const layout = `${named ? 'eye' : 'jewel'} ${rollsOn ? 'wide' : ''}`;
        return (
          <section key={group.id} className="group">
            <div className="group-head">
              {group.icons.map((icon) => (
                <img key={icon.icon} className="sprite" src={icon.icon} alt="" width={32} height={32} />
              ))}
              <h2>{group.title}</h2>
              <span className="count">{group.rows.length}</span>
            </div>
            <div className={`row head cap ${layout}`} aria-hidden="true">
              {named && <span>While under</span>}
              <span>{group.head}</span>
              {rollsOn ? <span>Rolls on</span> : <span className="pct">Chance</span>}
            </div>
            {group.rows.length === 0 && <p className="empty">Nothing matches.</p>}
            <ul>
              {group.rows.map(({ affix, lines, chance }) => (
                <li key={affix.id} className={`row ${layout}`}>
                  {named && <span className="name">{affix.aura}</span>}
                  <div className="stats">
                    {lines.map((line, i) => (
                      <div key={i}>
                        <StatLine line={line} />
                      </div>
                    ))}
                  </div>
                  {rollsOn ? (
                    <span className="tags">
                      {affix.tags.includes('any_jewel') ? (
                        <span className="tag">Any jewel</span>
                      ) : (
                        kinds
                          .filter((k) => affix.tags.includes(k.tag))
                          .map((k) => (
                            <span key={k.id} className="tag">
                              {short(k)}
                            </span>
                          ))
                      )}
                    </span>
                  ) : (
                    <span className="pct">{(chance * 100).toFixed(1)}%</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

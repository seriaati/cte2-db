import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  affixCounts: Record<string, number>;
  rarities: Rarity[];
  maxLevel: number;
}

const short = (item: JewelItem) => item.name.replace(' Jewel', '');

export default function JewelBrowser({ kinds, crafted, eye, affixes, affixCounts, rarities, maxLevel }: Props) {
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
    const count = affixCounts[rarity.id];
    const all: { id: string; title: string; icons: JewelItem[]; about: ReactNode; head: string; rows: ReturnType<typeof rows> }[] = [
      {
        id: 'jewel',
        title: 'Affixes',
        icons: kind ? [kind] : kinds,
        about: (
          <>
            A {rarity.name} jewel rolls {count} of these, never the same one twice. Each affix has its own tier,
            anywhere from Common up to the jewel's rarity, so the rarity picker sets the tier these ranges are shown
            at. {kind ? '' : 'Pick a jewel to see only what it can roll and the chance of each affix.'}
          </>
        ),
        head: tier,
        rows: rows(affixes.jewel.filter((a) => !kind || a.tags.includes('any_jewel') || a.tags.includes(kind.tag)), rarity),
      },
      {
        id: 'corruption',
        title: 'Corruption',
        icons: [],
        about: (
          <>
            An Orb of Mesmerizing Chaos either corrupts a jewel or destroys it, at even odds. A corrupted jewel gains
            one of these on top of its affixes, or two one time in ten. They roll a tier the same way.
          </>
        ),
        head: tier,
        rows: rows(affixes.corruption, rarity),
      },
      {
        id: 'crafted',
        title: 'Crafted unique',
        icons: [crafted],
        about: (
          <>
            The {crafted.name} is crafted from nine runes: Ano, Dos, Toq, Cen, Eno, Ita, Xer, Wir and Har. It starts
            with no stats and is upgraded six times with ten rarity stones each, Common first and Mythic last, which
            takes it to level 1, 20, 40, 60, 80 and 100. The first, third and last upgrade each add one of these, at
            any tier from Common to Mythic. You can only socket one.
          </>
        ),
        head: tier,
        rows: rows(affixes.crafted, rarity),
      },
      {
        id: 'eye',
        title: 'Abyssal Eye',
        icons: [eye],
        about: (
          <>
            The {eye.name} drops from uber bosses. Each of its affixes only counts while the augment beside it is on.
            A boss below level 75 gives an eye with one of these, a boss below level 100 two and a level 100 boss
            three, never the same one twice. They ignore rarity and roll anywhere in the ranges shown. The eye also
            carries one ordinary {kinds.find((k) => k.id === 'int')!.name} affix that its tooltip doesn't show. You can
            only socket one.
          </>
        ),
        head: `Rolls at lv ${level}`,
        rows: rows(affixes.eye, { ...rarity, minPercent: 0, maxPercent: 100 }),
      },
    ];
    return q ? all.filter((g) => g.rows.length) : all;
  }, [affixes, affixCounts, kinds, crafted, eye, kind, rarity, level, query]);

  return (
    <div className="content">
      <div className="title-row">
        <h1>Jewels</h1>
        <span className="context">
          {kind?.name ?? 'All jewels'} / <span className="rar">{rarity.name}</span> / Lv {level}
        </span>
      </div>
      <p className="lead">Jewels are socketed into your character instead of your gear. This is every stat they can roll in Craft to Exile 2.</p>

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

      <p className="note">
        Jewel sockets come from the talent tree, and a jewel only fits once you reach its level. Its flat values grow
        with that level. {kinds.map(short).join(', ').replace(/, (?=[^,]+$)/, ' and ')} jewels drop from monsters
        above level 5 and share most of their affixes. Chance is for a single roll, out of every affix in its list.
      </p>

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
            <p className="note about">{group.about}</p>
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

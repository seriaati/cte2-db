import { useEffect, useMemo } from 'react';
import { formatRange, rolled, type StatMod } from '../lib/affix';
import type { CodexAffix, CodexKind, CodexRarity } from '../lib/codexes';
import { useQuery } from '../lib/useQuery';
import { useStored } from '../lib/useStored';
import { LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';

interface Props {
  kinds: CodexKind[];
  affixes: CodexAffix[];
  rarities: CodexRarity[];
  affixTypes: Record<string, string>;
  icon: string;
  maxLevel: number;
}

const range = ({ min, max }: { min: number; max: number }) => (min === max ? `${min}` : `${min}–${max}`);

export default function CodexBrowser({ kinds, affixes, rarities, affixTypes, icon, maxLevel }: Props) {
  const [query, setQuery] = useQuery();
  const [rarityId, setRarityId] = useStored('rarity', rarities.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);
  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;

  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  const lines = (stats: StatMod[]) => stats.map((s) => formatRange(s, rolled(s, rarity.percent.min, level), rolled(s, rarity.percent.max, level)));
  const { codexes, groups } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (texts: string[]) => !q || texts.some((s) => s.toLowerCase().includes(q));
    const text = (shown: ReturnType<typeof lines>) => shown.map((l) => `${l.value} ${l.label}`);
    const codexes = kinds.map((kind) => ({ kind, lines: lines(kind.mods) })).filter((r) => matches([r.kind.name, ...text(r.lines)]));
    const groups = Object.entries(affixTypes)
      .map(([type, name]) => ({
        type,
        name,
        on: kinds.filter((k) => k.affixTypes.includes(type)).map((k) => k.name),
        rows: affixes
          .filter((a) => a.type === type)
          .map((affix) => ({ affix, lines: lines(affix.stats) }))
          .filter((r) => matches(text(r.lines))),
      }))
      .filter((g) => g.rows.length);
    return { codexes, groups };
  }, [kinds, affixes, affixTypes, rarity, level, query]);

  return (
    <div className="content">
      <div className="title-row">
        <h1>Codexes</h1>
        <span className="context">
          <span className="rar">{rarity.name}</span> / Lv {level}
        </span>
      </div>

      <div className="controls">
        <label className="field grow">
          <span className="cap">Search</span>
          <input className="in" type="search" placeholder="Name or stat" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
        <RaritySwatches rarities={rarities} value={rarityId} onChange={setRarityId} />
      </div>

      <p className="note">
        A codex asks for a number of worn pieces of each kind: normal (any rarity but unique and runeword), unique, and runed (runeword gear). A worn item counts toward
        the kind of its rarity, up to what is asked of that kind, and a slot condition makes its slot count only with the kind it names. With every piece worn the codex
        gives its own stats, and each affix comes one piece sooner than the last, the first at one piece short, never below two. The more a codex asks for, the higher its
        stats and affixes roll: (pieces + slot conditions) × 10 × the rarity's multiplier percent of their range.
      </p>

      <section className="group">
        <div className="group-head">
          <h2>Rules by rarity</h2>
        </div>
        <div className="row wide head cap" aria-hidden="true">
          <span>Rarity</span>
          <span>Asks for</span>
          <span>Rolls at</span>
        </div>
        <ul>
          {rarities.map((r) => (
            <li key={r.id} className="row wide">
              <strong className="name" style={{ color: r.ink }}>
                {r.name}
              </strong>
              <div className="stats">
                <div>
                  {range(r.pieces.normal)} normal, {range(r.pieces.unique)} unique and {range(r.pieces.runed)} runed pieces
                </div>
                <div>
                  {range(r.affixes)} {r.affixes.max === 1 ? 'affix' : 'affixes'}, {range(r.slots)} slot {r.slots.max === 1 ? 'condition' : 'conditions'}
                </div>
              </div>
              <div className="tags">
                {range(r.percent)}% of the range (×{r.multi})
              </div>
            </li>
          ))}
        </ul>
      </section>

      {codexes.length + groups.length === 0 && <p className="empty">Nothing matches.</p>}
      {codexes.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>Codexes</h2>
            <span className="count">{codexes.length}</span>
          </div>
          <div className="row codex head cap" aria-hidden="true">
            <span>Codex</span>
            <span>
              Stats at {rarity.name}, lv {level}
            </span>
            <span>Affixes</span>
          </div>
          <ul>
            {codexes.map(({ kind, lines: shown }) => (
              <li key={kind.id} className="row codex">
                <div className="name named">
                  <img className="sprite" src={icon} alt="" width={32} height={32} />
                  {kind.name}
                </div>
                <div className="stats">
                  {shown.map((line, i) => (
                    <div key={i}>
                      <StatLine line={line} />
                    </div>
                  ))}
                </div>
                <span className="tags">
                  {kind.affixTypes.map((type) => (
                    <span key={type} className="tag">
                      {affixTypes[type] ?? type}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.type} className="group">
          <div className="group-head">
            <h2>{group.name}</h2>
            <span className="count">{group.rows.length}</span>
            <span className="pool">On {group.on.join(', ')}</span>
          </div>
          <div className="row codex-affix head cap" aria-hidden="true">
            <span>
              Stats at {rarity.name}, lv {level}
            </span>
          </div>
          <ul>
            {group.rows.map(({ affix, lines: shown }) => (
              <li key={affix.id} className="row codex-affix">
                <div className="stats">
                  {shown.map((line, i) => (
                    <div key={i}>
                      <StatLine line={line} />
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

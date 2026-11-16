import { useMemo, useState } from 'react';
import { formatStat, type Base, type Rarity } from '../lib/affix';
import type { Rune, Runeword } from '../lib/runes';
import { Dropdown, gearLabel, gearOptions, GearRail, GearSelect, LevelStepper } from './controls';
import { StatLine } from './StatLine';
import { useStored } from '../lib/useStored';

interface Props {
  runes: Rune[];
  runewords: Runeword[];
  bases: Base[];
  slotNames: Record<string, string>;
  tagNames: Record<string, string>;
  rarity: Rarity;
  maxLevel: number;
}

const FAMILIES = [
  { id: 'Weapon', label: 'Weapon' },
  { id: 'OffHand', label: 'Off-hand' },
  { id: 'Armor', label: 'Armor' },
  { id: 'Jewelry', label: 'Jewelry' },
];

// The three stat lists a rune carries. Off-hand gear uses the armor one.
const KINDS = [
  { id: 'Weapon', label: 'Weapons' },
  { id: 'Armor', label: 'Armor, off-hand' },
  { id: 'Jewelry', label: 'Jewelry' },
] as const;

const text = (line: { value: string; label: string }) => `${line.value} ${line.label}`.toLowerCase();

export default function RuneBrowser({ runes, runewords, bases, slotNames, tagNames, rarity, maxLevel }: Props) {
  const [query, setQuery] = useState('');
  const [gear, setGear] = useState<string[]>([]);
  const [runeId, setRuneId] = useState('');
  const [level, setLevel] = useStored('level', maxLevel);

  const options = useMemo(
    () => gearOptions(bases, tagNames, (b) => runewords.filter((w) => w.slots.includes(b.slot)).map((w) => w.id).join()),
    [bases, tagNames, runewords],
  );
  const chosen = useMemo(() => options.filter((o) => gear.includes(o.id)), [options, gear]);
  const fits = (word: Runeword, bases: Base[]) => bases.some((b) => word.slots.includes(b.slot));
  const kinds = KINDS.filter((k) => !chosen.length || chosen.some((o) => k.id === (o.family === 'OffHand' ? 'Armor' : o.family)));
  const picked = runes.find((r) => r.id === runeId);
  const q = query.trim().toLowerCase();

  const runeRows = useMemo(() => {
    const usable = runewords.filter((w) => !chosen.length || chosen.some((o) => fits(w, o.bases)));
    return runes
      .map((rune) => {
        // Kinds of gear that get the same stats from the rune share one entry.
        const stats: { labels: string[]; lines: ReturnType<typeof formatStat>[] }[] = [];
        for (const kind of kinds) {
          const lines = rune.stats[kind.id].map((s) => formatStat(s, rarity, level));
          const same = stats.find((s) => s.lines.map(text).join() === lines.map(text).join());
          if (same) same.labels.push(kind.label);
          else stats.push({ labels: [kind.label], lines });
        }
        return { rune, stats, uses: usable.filter((w) => w.runes.includes(rune.id)).length };
      })
      .filter((r) => !q || r.rune.name.toLowerCase().includes(q) || r.stats.some((s) => s.lines.some((l) => text(l).includes(q))));
  }, [runes, runewords, chosen, rarity, level, q]);

  const groups = useMemo(() => {
    const rows = runewords
      .filter((w) => !runeId || w.runes.includes(runeId))
      .map((word) => ({ word, lines: word.stats.map((s) => formatStat(s, rarity, level)) }))
      .filter(
        (r) =>
          !q ||
          r.word.name.toLowerCase().includes(q) ||
          r.lines.some((l) => text(l).includes(q)) ||
          r.word.runes.some((id) => runes.find((x) => x.id === id)!.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.word.runes.length - b.word.runes.length || a.word.name.localeCompare(b.word.name));
    const all = chosen.length
      ? chosen.map((o) => ({ id: o.id, label: o.name, rows: rows.filter((r) => fits(r.word, o.bases)) }))
      : FAMILIES.map((f) => ({ ...f, rows: rows.filter((r) => r.word.family === f.id) }));
    return all.filter((g) => g.rows.length);
  }, [runes, runewords, chosen, runeId, rarity, level, q]);

  return (
    <div className="browser">
      <GearRail options={options} tagNames={tagNames} selected={gear} onChange={setGear} anyLabel="All gear" />

      <div className="content">
        <div className="title-row">
          <h1>Runes</h1>
          <span className="context">
            {gearLabel(options, gear)} / <span className="rar">{picked?.name ?? 'Any rune'}</span> / Lv {level}
          </span>
        </div>

        <div className="controls">
          <label className="field grow">
            <span className="cap">Search</span>
            <input className="in" type="search" placeholder="Name or stat" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <GearSelect options={options} selected={gear} onChange={setGear} anyLabel="All gear" />
          <Dropdown
            className="with-rune"
            label="Runewords with"
            value={runeId}
            groups={[{ options: [{ value: '', label: 'Any rune' }, ...runes.map((r) => ({ value: r.id, label: r.name }))] }]}
            onChange={setRuneId}
          />
          <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
        </div>

        <section key={`${gear}`} className="group">
          <div className="group-head">
            <h2>Runes</h2>
            <span className="count">{runeRows.length}</span>
          </div>
          <div className="row rune head cap" aria-hidden="true">
            <span>Rune</span>
            <span>Stats at lv {level}</span>
            <span className="pct">Drop lv</span>
            <span>Drops from</span>
          </div>
          {runeRows.length === 0 && <p className="empty">Nothing matches.</p>}
          <ul>
            {runeRows.map(({ rune, stats, uses }) => (
              <li key={rune.id} className="row rune">
                <div className="name named">
                  <img className="sprite" src={rune.icon} alt="" width={32} height={32} />
                  <div>
                    {rune.name}
                    {uses ? (
                      <a className="uses" href="#runewords" onClick={() => setRuneId(rune.id)}>
                        {uses} {uses === 1 ? 'runeword' : 'runewords'}
                      </a>
                    ) : (
                      <span className="uses">No runewords</span>
                    )}
                  </div>
                </div>
                <div className={`stats ${kinds.length === 1 ? '' : 'by-gear'}`}>
                  {stats.map((s) => [
                    kinds.length > 1 && (
                      <span key={s.labels[0]} className="cap">
                        {s.labels.length === KINDS.length ? 'Any gear' : s.labels.join(', ')}
                      </span>
                    ),
                    <div key={`${s.labels[0]}-lines`}>
                      {s.lines.map((line, i) => (
                        <div key={i}>
                          <StatLine line={line} />
                        </div>
                      ))}
                    </div>,
                  ])}
                </div>
                <span className="pct">{rune.drops && `Lv ${rune.dropLevel}`}</span>
                <span className="tags">{rune.drops ? 'Any loot' : <span className="tag not">Not a random drop</span>}</span>
              </li>
            ))}
          </ul>
        </section>

        <div id="runewords" />
        {groups.length === 0 && <p className="empty">No runeword matches.</p>}
        {groups.map((group) => (
          <section key={`${group.id}/${gear}`} className="group">
            <div className="group-head">
              <h2>{group.label} runewords</h2>
              <span className="count">{group.rows.length}</span>
            </div>
            <div className="row runeword head cap" aria-hidden="true">
              <span>Runeword</span>
              <span>Runes, in order</span>
              <span>Stats at lv {level}</span>
              <span>Goes on</span>
            </div>
            <ul>
              {group.rows.map(({ word, lines }) => (
                <li key={word.id} className="row runeword">
                  <span className="name">{word.name}</span>
                  <ol className="word">
                    {word.runes.map((id) => (
                      <li key={id}>
                        <button className="rune-chip" type="button" aria-pressed={id === runeId} onClick={() => setRuneId(id === runeId ? '' : id)}>
                          <img className="sprite" src={runes.find((r) => r.id === id)!.icon} alt="" width={32} height={32} />
                          {id}
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="stats">
                    {lines.map((line, i) => (
                      <div key={i}>
                        <StatLine line={line} />
                      </div>
                    ))}
                  </div>
                  <span className="tags">
                    {word.slots.map((slot) => (
                      <span key={slot} className="tag">
                        {slotNames[slot]}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

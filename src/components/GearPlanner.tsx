import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { canRoll, formatRange, type Affix, type Rarity } from '../lib/affix';
import type { Gem, GemRank } from '../lib/gems';
import { useSwap } from '../lib/motion';
import {
  baseRange,
  changesBase,
  encodePlan,
  formedRuneword,
  itemName,
  matches,
  rollWindows,
  slotCount,
  type Part,
  type PlanAffix,
  type PlanBase,
  type PlanRarity,
} from '../lib/plannerRules';
import type { Rune, Runeword } from '../lib/runes';
import { GearRail, GearSelect, LevelStepper, RaritySwatches } from './controls';
import { Sockets, socketPart, type Socketed } from './planner/Sockets';
import { StatLine, StatLines } from './StatLine';
import { useStored } from '../lib/useStored';

interface Props {
  affixes: PlanAffix[];
  infusions: Affix[];
  bases: PlanBase[];
  rarities: PlanRarity[];
  runes: Rune[];
  gems: Gem[];
  ranks: GemRank[];
  runewords: Runeword[];
  tagNames: Record<string, string>;
  maxLevel: number;
}

const SLOT_TYPES = [
  { id: 'prefix', label: 'Prefixes', one: 'Prefix' },
  { id: 'suffix', label: 'Suffixes', one: 'Suffix' },
] as const;

// The sockets a rarity has room for: it caps how many there are, and how many of them hold gems and runes.
function socketsFor(rarity: PlanRarity, sockets: Socketed[]) {
  const kept = { gem: 0, rune: 0 };
  return sockets.slice(0, rarity.sockets).filter((s) => kept[s.kind]++ < (s.kind === 'gem' ? rarity.maxGems : rarity.maxRunes));
}

// Odds of each affix on a single roll from the pool, likeliest first.
function odds<T extends Affix>(pool: T[]) {
  const totalWeight = pool.reduce((sum, a) => sum + a.weight, 0);
  return pool
    .map((affix) => ({ affix, chance: affix.weight / totalWeight }))
    .sort((a, b) => b.chance - a.chance || a.affix.name.localeCompare(b.affix.name));
}

function RollWindow({ label, rolls }: { label: string; rolls: Rarity }) {
  return (
    <span className="pool window">
      {label} {rolls.minPercent}–{rolls.maxPercent}%
      <span className="track" style={{ '--from': `${rolls.minPercent}%`, '--to': `${rolls.maxPercent}%` } as CSSProperties} />
    </span>
  );
}

// One removable thing in the planned item card.
function Entry({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="item-entry">
      <div>{children}</div>
      <button className="item-remove" type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

interface OptionListProps<T extends Affix> {
  heading: string;
  options: { affix: T; chance: number }[];
  rolls: Rarity;
  level: number;
  // Set where one option is always chosen (the implicit); left out where options go into slots.
  selected?: T;
  // Infusions have no names in the game, so their list drops the name column.
  unnamed?: boolean;
  query: string;
  onPick: (affix: T) => void;
}

function OptionList<T extends Affix>({ heading, options, rolls, level, selected, unnamed, query, onPick }: OptionListProps<T>) {
  const row = `row opt ${unnamed ? 'unnamed' : ''}`;
  const shown = options.filter(({ affix }) => matches(query, unnamed ? '' : affix.name, { stats: affix.stats, rolls, level }));
  if (shown.length === 0) return <p className="empty">Nothing matches.</p>;
  return (
    <>
      <div className={`${row} head cap`} aria-hidden="true">
        {!unnamed && <span>Name</span>}
        <span>{heading}</span>
        <span className="pct">Chance</span>
      </div>
      <ul>
        {shown.map(({ affix, chance }) => (
          <li key={affix.id}>
            <button className={row} type="button" aria-pressed={selected ? affix === selected : undefined} onClick={() => onPick(affix)}>
              {!unnamed && <span className="name">{affix.name}</span>}
              <span className="stats">
                <StatLines stats={affix.stats} rolls={rolls} level={level} />
              </span>
              <span className="pct">{(chance * 100).toFixed(1)}%</span>
              <span className="mark" aria-hidden="true">
                {!selected && '+'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function GearPlanner({ affixes, infusions, bases, rarities, runes, gems, ranks, runewords, tagNames, maxLevel }: Props) {
  // Runed gear is the one rarity that forms runewords; infusions and affix tiers use the others.
  const tiers = rarities.filter((r) => !r.runewords);
  const [baseId, setBaseId] = useState(bases[0].id);
  const [rarityId, setRarityId] = useStored('rarity', tiers.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);
  const [implicitId, setImplicitId] = useState('');
  const [picks, setPicks] = useState<Record<'prefix' | 'suffix', PlanAffix[]>>({ prefix: [], suffix: [] });
  const [infusionId, setInfusionId] = useState('');
  const [infusionRarityId, setInfusionRarityId] = useStored('infusionRarity', tiers.at(-1)!.id);
  const [sockets, setSockets] = useState<Socketed[]>([]);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const query = search.trim().toLowerCase();
  const plan = useSwap<HTMLDivElement>(baseId);

  const base = bases.find((b) => b.id === baseId)!;
  const rarity = rarities.find((r) => r.id === rarityId) ?? tiers.at(-1)!;
  const rolls = rollWindows(rarity);
  const rollable = affixes.filter((a) => canRoll(a, base));

  const implicits = odds(rollable.filter((a) => a.type === 'implicit'));
  // A drop always gets an implicit when its base has any, so the planner never leaves it empty.
  const implicit = (implicits.find((o) => o.affix.id === implicitId) ?? implicits[0])?.affix;

  const parts = SLOT_TYPES.map((t) => {
    const picked = picks[t.id];
    // The game rerolls each slot from what is left, so a placed affix is out of the pool unless it may repeat.
    const options = odds(rollable.filter((a) => a.type === t.id && (a.repeatable || !picked.includes(a))));
    return { ...t, picked, options, slots: slotCount(rarity, t.id) };
  });

  // An infusion has its own rarity, apart from the item's, and sits at the top of that rarity's
  // range instead of rolling (GearInfusionData.getPercent).
  const infusionRarity = tiers.find((r) => r.id === infusionRarityId) ?? tiers.at(-1)!;
  const infusionRolls = { ...infusionRarity, minPercent: infusionRarity.maxPercent };
  const infusionOptions = odds(infusions.filter((a) => canRoll(a, base)));
  const infusion = infusionOptions.find((o) => o.affix.id === infusionId)?.affix;
  const infusionInk = { '--rar': infusionRarity.ink } as CSSProperties;

  // Runes and runewords roll anywhere in their range whatever the rarity (RuneItem, GearSocketsData.setRuneword).
  const socketRolls = { ...rarity, minPercent: 0, maxPercent: 100 };
  const socketedRunes = sockets.filter((s) => s.kind === 'rune').map((s) => s.item.id);
  const runeword = rarity.runewords ? formedRuneword(runewords, socketedRunes, base.slot) : undefined;

  const basePart: Part = { stats: base.stats, rolls: rolls.base, level };
  const otherParts: Part[] = [
    ...(implicit ? [{ stats: implicit.stats, rolls: rolls.implicit, level }] : []),
    ...[...picks.prefix, ...picks.suffix].map((a) => ({ stats: a.stats, rolls: rolls.affix, level })),
    ...sockets.map((s) => socketPart(s, base, socketRolls, level)),
    ...(runeword ? [{ stats: runeword.stats, rolls: socketRolls, level }] : []),
    ...(infusion ? [{ stats: infusion.stats, rolls: infusionRolls, level }] : []),
  ];
  const baseLines = base.stats.map((stat, i) => (
    <span key={i} className="line">
      <StatLine line={formatRange(stat, ...baseRange(stat, basePart, otherParts))} />
    </span>
  ));

  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  const changeBase = (id: string) => {
    const next = bases.find((b) => b.id === id)!;
    const keep = (list: PlanAffix[]) => list.filter((a) => canRoll(a, next));
    setBaseId(id);
    setPicks({ prefix: keep(picks.prefix), suffix: keep(picks.suffix) });
    if (implicit && !canRoll(implicit, next)) setImplicitId('');
  };

  const changeRarity = (id: string) => {
    const next = rarities.find((r) => r.id === id)!;
    setRarityId(id);
    setPicks({
      prefix: picks.prefix.slice(0, slotCount(next, 'prefix')),
      suffix: picks.suffix.slice(0, slotCount(next, 'suffix')),
    });
    setSockets(socketsFor(next, sockets));
  };

  // An item opened from a link takes the place of the one on the page, and leaves the address bar
  // so that a reload doesn't bring it back over later changes. Parts the link's gear can't have are dropped.
  useEffect(() => {
    const load = () => {
      const link = new URLSearchParams(location.hash.slice(1));
      const list = (key: string) => link.get(key)?.split(',') ?? [];
      const nextBase = bases.find((b) => b.id === link.get('base'));
      if (!nextBase) return;
      history.replaceState(null, '', location.pathname);
      const nextRarity = rarities.find((r) => r.id === link.get('rarity')) ?? tiers.at(-1)!;
      const slots = (type: 'prefix' | 'suffix') =>
        list(type)
          .flatMap((id) => affixes.find((a) => a.id === id && a.type === type && canRoll(a, nextBase)) ?? [])
          .filter((a, i, all) => a.repeatable || all.indexOf(a) === i)
          .slice(0, slotCount(nextRarity, type));
      const socketed = list('sockets').flatMap((entry): Socketed[] => {
        const [kind, id] = entry.split(':');
        const gem = kind === 'gem' && gems.find((g) => g.id === id);
        const rune = kind === 'rune' && runes.find((r) => r.id === id);
        return gem ? [{ kind: 'gem', item: gem }] : rune ? [{ kind: 'rune', item: rune }] : [];
      });
      setBaseId(nextBase.id);
      setRarityId(nextRarity.id);
      setLevel(Math.min(maxLevel, Math.max(1, Number(link.get('level')) || maxLevel)));
      setImplicitId(link.get('implicit') ?? '');
      setPicks({ prefix: slots('prefix'), suffix: slots('suffix') });
      setSockets(socketsFor(nextRarity, socketed));
      setInfusionId(link.get('infusion') ?? '');
      if (tiers.some((r) => r.id === link.get('infusionRarity'))) setInfusionRarityId(link.get('infusionRarity')!);
    };
    load();
    addEventListener('hashchange', load);
    return () => removeEventListener('hashchange', load);
  }, []);

  const share = async () => {
    const link = encodePlan({
      base: baseId,
      rarity: rarity.id,
      level,
      implicit: implicit?.id,
      prefix: picks.prefix.map((a) => a.id),
      suffix: picks.suffix.map((a) => a.id),
      sockets: sockets.map((s) => `${s.kind}:${s.item.id}`),
      infusion: infusion?.id,
      infusionRarity: infusionRarity.id,
    });
    const url = `${location.origin}${location.pathname}#${link}`;
    // The clipboard is off limits on pages not served over HTTPS; there the link is shown to copy by hand.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copy this link', url);
    }
  };

  const reset = () => {
    setImplicitId('');
    setPicks({ prefix: [], suffix: [] });
    setSockets([]);
    setInfusionId('');
  };

  return (
    <div className="browser">
      <GearRail bases={bases} tagNames={tagNames} value={baseId} onChange={changeBase} />

      <div className="content">
        <div className="title-row">
          <h1>Gear planner</h1>
          <span className="context">
            {base.name} / <span className="rar">{rarity.name}</span> / Lv {level}
          </span>
        </div>

        <div className="controls">
          <label className="field grow">
            <span className="cap">Search</span>
            <input className="in" type="search" placeholder="Name or stat" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <GearSelect bases={bases} value={baseId} onChange={changeBase} />
          <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
          <RaritySwatches rarities={rarities} value={rarityId} onChange={changeRarity} />
        </div>

        <div className="plan" ref={plan}>
          <div className="parts">
            <section id="base" className="group">
              <div className="group-head">
                <h2>Base</h2>
                <RollWindow label="Base rolls" rolls={rolls.base} />
              </div>
              <div className="base-stats">
                {base.stats.length === 0 && <span className="line open">{base.name} has no base stats.</span>}
                {baseLines}
                {changesBase(basePart, otherParts) && (
                  <span className="line open">Includes the Gear's Defense and Gear's Weapon Damage from the parts below.</span>
                )}
              </div>
            </section>

            {implicit && (
              <section id="implicit" className="group fixed">
                <div className="group-head">
                  <h2>Implicit</h2>
                  <span className="count">{implicits.length}</span>
                  <RollWindow label="Any rarity rolls" rolls={rolls.implicit} />
                </div>
                <OptionList
                  heading={`Rolls at lv ${level}`}
                  options={implicits}
                  rolls={rolls.implicit}
                  level={level}
                  selected={implicit}
                  query={query}
                  onPick={(affix) => setImplicitId(affix.id)}
                />
              </section>
            )}

            {parts.map((part) => (
              <section key={part.id} id={part.id} className="group">
                <div className="group-head">
                  <h2>{part.label}</h2>
                  <span className="count">
                    {part.picked.length}/{part.slots}
                  </span>
                  {part.slots > 0 && <RollWindow label={`${rarity.name} tier rolls`} rolls={rolls.affix} />}
                </div>
                {part.slots > 0 && (
                  <ul className="slots">
                    {Array.from({ length: part.slots }, (_, i) => {
                      const affix = part.picked[i];
                      return (
                        <li key={i} className={`slot ${affix ? 'filled' : ''}`}>
                          <span className="name">
                            <span className="cap">
                              {part.one} {i + 1}
                            </span>
                            {affix?.name}
                          </span>
                          <span className="stats">{affix ? <StatLines stats={affix.stats} rolls={rolls.affix} level={level} /> : 'Empty'}</span>
                          {affix && (
                            <button
                              className="btn remove"
                              type="button"
                              aria-label={`Remove ${affix.name}`}
                              onClick={() => setPicks({ ...picks, [part.id]: part.picked.filter((_, j) => j !== i) })}
                            >
                              ×
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {part.slots === 0 ? (
                  <p className="empty">
                    {rarity.name} gear has no {part.id} slot.
                  </p>
                ) : part.picked.length === part.slots ? (
                  <p className="empty">Every slot is filled. Remove one to pick another {part.id}.</p>
                ) : (
                  <OptionList
                    heading={`Rolls at ${rarity.name}, lv ${level}`}
                    options={part.options}
                    rolls={rolls.affix}
                    level={level}
                    query={query}
                    onPick={(affix) => setPicks({ ...picks, [part.id]: [...part.picked, affix] })}
                  />
                )}
              </section>
            ))}

            <Sockets
              base={base}
              rarity={rarity}
              level={level}
              rolls={socketRolls}
              sockets={sockets}
              onChange={setSockets}
              runeword={runeword}
              runes={runes}
              gems={gems}
              ranks={ranks}
              runewords={runewords}
              query={query}
            />

            <section id="infusion" className="group" style={infusionInk}>
              <div className="group-head">
                <h2>Infusion</h2>
                <span className="count">{infusion ? 1 : 0}/1</span>
              </div>
              {infusionOptions.length === 0 ? (
                <p className="empty">No infusions fit {base.name}.</p>
              ) : (
                <>
                  <div className="controls part-controls">
                    <RaritySwatches label="Infusion rarity" rarities={tiers} value={infusionRarity.id} onChange={setInfusionRarityId} />
                  </div>
                  <ul className="slots">
                    <li className={`slot ${infusion ? 'filled' : ''}`}>
                      <span className="name">
                        <span className="cap">Infusion</span>
                      </span>
                      <span className="stats">{infusion ? <StatLines stats={infusion.stats} rolls={infusionRolls} level={level} /> : 'Empty'}</span>
                      {infusion && (
                        <button className="btn remove" type="button" aria-label="Remove infusion" onClick={() => setInfusionId('')}>
                          ×
                        </button>
                      )}
                    </li>
                  </ul>
                  {!infusion && (
                    <OptionList
                      heading={`Gives at ${infusionRarity.name}, lv ${level}`}
                      options={infusionOptions}
                      rolls={infusionRolls}
                      level={level}
                      unnamed
                      query={query}
                      onPick={(affix) => setInfusionId(affix.id)}
                    />
                  )}
                </>
              )}
            </section>
          </div>

          <aside className="item" aria-label="Planned item">
            <div className="item-head">
              <span className="cap">Planned item</span>
              <span className="item-actions">
                <button className="item-remove item-action" type="button" onClick={share}>
                  {copied ? 'Copied' : 'Share'}
                </button>
                <button className="item-remove item-action" type="button" onClick={reset}>
                  Reset
                </button>
              </span>
            </div>
            <div className="item-name rar">{itemName(base, implicit, picks.prefix[0], picks.suffix[0])}</div>
            <div className="cap">
              {rarity.name} {base.name} / Lv {level}
            </div>
            {base.stats.length > 0 && (
              <div className="item-part">
                <a className="cap" href="#base">
                  Base
                </a>
                {baseLines}
              </div>
            )}
            {implicit && (
              <div key={implicit.id} className="item-part fixed">
                <a className="cap" href="#implicit">
                  Implicit
                </a>
                <StatLines stats={implicit.stats} rolls={rolls.implicit} level={level} />
              </div>
            )}
            {parts.map(
              (part) =>
                part.slots > 0 && (
                  <div key={part.id} className="item-part">
                    <a className="cap" href={`#${part.id}`}>
                      {part.label} {part.picked.length}/{part.slots}
                    </a>
                    {part.picked.map((affix, i) => (
                      <Entry key={affix.id + i} label={affix.name} onRemove={() => setPicks({ ...picks, [part.id]: part.picked.filter((_, j) => j !== i) })}>
                        <StatLines stats={affix.stats} rolls={rolls.affix} level={level} />
                      </Entry>
                    ))}
                    {part.picked.length < part.slots && <span className="line open">{part.slots - part.picked.length} empty</span>}
                  </div>
                ),
            )}
            <div className="item-part fixed">
              <a className="cap" href="#sockets">
                Sockets {sockets.length}/{rarity.sockets}
              </a>
              {sockets.map((s, i) => (
                <Entry key={s.item.id + i} label={s.item.name} onRemove={() => setSockets(sockets.filter((_, j) => j !== i))}>
                  <StatLines {...socketPart(s, base, socketRolls, level)} />
                </Entry>
              ))}
              {sockets.length < rarity.sockets && <span className="line open">{rarity.sockets - sockets.length} empty</span>}
            </div>
            {runeword && (
              <div className="item-part fixed">
                <a className="cap" href="#sockets">
                  Runeword: {runeword.name}
                </a>
                <StatLines stats={runeword.stats} rolls={socketRolls} level={level} />
              </div>
            )}
            {infusionOptions.length > 0 && (
              <div className="item-part" style={infusionInk}>
                <a className="cap" href="#infusion">
                  {infusion ? `${infusionRarity.name} infusion` : 'Infusion 0/1'}
                </a>
                {infusion ? (
                  <Entry key={infusion.id} label="infusion" onRemove={() => setInfusionId('')}>
                    <StatLines stats={infusion.stats} rolls={infusionRolls} level={level} />
                  </Entry>
                ) : (
                  <span className="line open">1 empty</span>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

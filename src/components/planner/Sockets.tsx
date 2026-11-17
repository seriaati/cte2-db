import { useState } from 'react';
import type { Rarity } from '../../lib/affix';
import type { Gem, GemRank } from '../../lib/gems';
import { matches, socketPart, type PlanBase, type PlanRarity, type Socketed } from '../../lib/plannerRules';
import type { Rune, Runeword } from '../../lib/runes';
import { Dropdown } from '../controls';
import { StatLines } from '../StatLine';

interface Props {
  base: PlanBase;
  rarity: PlanRarity;
  level: number;
  rolls: Rarity;
  sockets: Socketed[];
  onChange: (sockets: Socketed[]) => void;
  runeword?: Runeword;
  runes: Rune[];
  gems: Gem[];
  ranks: GemRank[];
  runewords: Runeword[];
  query: string;
}

export function Sockets({ base, rarity, level, rolls, sockets, onChange, runeword, runes, gems, ranks, runewords, query }: Props) {
  const [tab, setTab] = useState('');
  const [tier, setTier] = useState(ranks.at(-1)!.tier);

  const count = (kind: Socketed['kind']) => sockets.filter((s) => s.kind === kind).length;
  const tabs = [
    { id: 'gem', label: 'Gems', on: rarity.maxGems > 0 },
    { id: 'rune', label: 'Runes', on: rarity.maxRunes > 0 },
    { id: 'runeword', label: 'Runewords', on: rarity.runewords },
  ].filter((t) => t.on);
  const open = tabs.find((t) => t.id === tab) ?? tabs[0];
  const full = sockets.length === rarity.sockets;
  const rune = (id: string) => runes.find((r) => r.id === id)!;
  const runeNames = (word: Runeword) => word.runes.map((id) => rune(id).name.replace(' Rune', ''));
  const fitting = runewords.filter((w) => w.slots.includes(base.slot));
  const fits = (socketed: Socketed) => matches(query, socketed.item.name, socketPart(socketed, base, rolls, level));
  const add = (socketed: Socketed) => onChange([...sockets, socketed]);

  const named = (item: { icon: string; name: string }) => (
    <span className="socket-name">
      <img className="socket-sprite" src={item.icon} alt="" width={24} height={24} />
      {item.name}
    </span>
  );
  const list = (options: React.ReactNode[]) => (options.length ? <ul>{options}</ul> : <p className="empty">Nothing matches.</p>);
  const option = (key: string, name: React.ReactNode, stats: React.ReactNode, onPick: () => void) => (
    <li key={key}>
      <button className="row opt pick" type="button" onClick={onPick}>
        <span className="name">{name}</span>
        <span className="stats">{stats}</span>
        <span className="mark" aria-hidden="true">
          +
        </span>
      </button>
    </li>
  );

  return (
    <section id="sockets" className="group fixed">
      <div className="group-head">
        <h2>Sockets</h2>
        <span className="count">
          {sockets.length}/{rarity.sockets}
        </span>
      </div>

      <ul className="slots">
        {Array.from({ length: rarity.sockets }, (_, i) => {
          const socketed = sockets[i];
          return (
            <li key={i} className={`slot ${socketed ? 'filled' : ''}`}>
              <span className="name">
                <span className="cap">Socket {i + 1}</span>
                {socketed && named(socketed.item)}
              </span>
              <span className="stats">{socketed ? <StatLines {...socketPart(socketed, base, rolls, level)} /> : 'Empty'}</span>
              {socketed && (
                <button
                  className="btn remove"
                  type="button"
                  aria-label={`Remove ${socketed.item.name}`}
                  onClick={() => onChange(sockets.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
        {runeword && (
          <li className="slot filled">
            <span className="name">
              <span className="cap">Runeword</span>
              {runeword.name}
            </span>
            <span className="stats">
              <StatLines stats={runeword.stats} rolls={rolls} level={level} />
            </span>
          </li>
        )}
      </ul>

      <div className="controls part-controls">
        {tabs.length > 1 && (
          <div className="seg" role="group" aria-label="What to socket">
            {tabs.map((t) => (
              <button key={t.id} className="btn" type="button" aria-pressed={t === open} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        {open.id === 'gem' && (
          <Dropdown
            label="Gem rank"
            value={`${tier}`}
            groups={[{ options: ranks.map((r) => ({ value: `${r.tier}`, label: r.name })) }]}
            onChange={(v) => setTier(+v)}
          />
        )}
      </div>

      {open.id === 'runeword' ? (
        fitting.length === 0 ? (
          <p className="empty">No runeword fits {base.name}.</p>
        ) : (
          list(
            fitting
              .filter((word) => matches(query, `${word.name} ${runeNames(word).join(' ')}`, { stats: word.stats, rolls, level }))
              .map((word) =>
                option(
                  word.id,
                  word.name,
                  <>
                    <span className="line cap">{runeNames(word).join(' · ')}</span>
                    <StatLines stats={word.stats} rolls={rolls} level={level} />
                  </>,
                  // Picking a runeword sockets its runes, in order, in place of what was there.
                  () => onChange(word.runes.map((id) => ({ kind: 'rune', item: rune(id) }))),
                ),
              ),
          )
        )
      ) : full ? (
        <p className="empty">Every socket is filled. Remove one to socket something else.</p>
      ) : open.id === 'gem' ? (
        count('gem') >= rarity.maxGems ? (
          <p className="empty">This gear can't hold more gems.</p>
        ) : (
          list(
            gems
              .filter((g) => g.tier === tier && fits({ kind: 'gem', item: g }))
              .map((gem) =>
                option(gem.id, named(gem), <StatLines {...socketPart({ kind: 'gem', item: gem }, base, rolls, level)} />, () =>
                  add({ kind: 'gem', item: gem }),
                ),
              ),
          )
        )
      ) : count('rune') >= rarity.maxRunes ? (
        <p className="empty">This gear can't hold more runes.</p>
      ) : (
        list(
          runes
            .filter((r) => !sockets.some((s) => s.item === r) && fits({ kind: 'rune', item: r }))
            .map((r) =>
              option(r.id, named(r), <StatLines {...socketPart({ kind: 'rune', item: r }, base, rolls, level)} />, () =>
                add({ kind: 'rune', item: r }),
              ),
            ),
        )
      )}
    </section>
  );
}

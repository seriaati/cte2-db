import { useState, type CSSProperties } from 'react';
import { nameOf, readItem } from '../../lib/buildCalc';
import { GEAR_SLOTS, exactly, needsAt, type GearSlot, type Item } from '../../lib/buildRules';
import { GearIcon } from '../controls';
import { CodexEditor } from './CodexEditor';
import { ItemEditor, spriteOf } from './ItemEditor';
import { Loading, Picker, useSection, type Choice, type TabProps } from './shared';
import { useTotals } from './totals';

export default function GearTab({ core, build, change, rolls, reset }: TabProps) {
  const data = useSection('gear');
  const [slot, setSlot] = useState<GearSlot | 'codex'>('weapon');
  const [choosing, setChoosing] = useState(false);
  const totals = useTotals(build);
  if (!data) return <Loading />;

  const place = GEAR_SLOTS.find((s) => s.id === slot);
  const item = place && build.gear[place.id];
  const needs = (worn: Item) =>
    needsAt(data.bases.find((b) => b.id === worn.base)?.needs ?? [], data.requirement, worn.level)
      .map((n) => `${n.value} ${totals?.rules.defs[n.stat]?.name ?? n.stat}`)
      .join(', ');
  const setItem = (next: Item | undefined) => {
    const { [slot as GearSlot]: _, ...others } = build.gear;
    change({ gear: next ? { ...others, [slot]: next } : others });
  };

  const fresh = { level: build.level, prefix: [], suffix: [], sockets: [], enchants: [] };
  const topTier = data.rarities.filter((r) => !r.runewords).at(-1)!.id;
  const choices = (): Choice[] => [
    ...data.bases.filter(place!.fits).map((b) => ({ id: `base:${b.id}`, name: b.name, picture: b.sprites[topTier], group: 'Base gear', part: { stats: b.stats, rolls: exactly(100), level: build.level } })),
    ...data.uniques
      .filter((u) => place!.fits(data.bases.find((b) => b.id === u.base)!))
      .map((u) => ({ id: `unique:${u.id}`, name: u.name, picture: u.sprite, group: 'Uniques', ink: data.uniqueRarity.ink, part: { stats: u.stats, rolls: exactly(100), level: build.level } })),
  ];
  const choose = (id: string) => {
    const [type, key] = id.split(/:(.*)/);
    if (type === 'base') setItem({ ...fresh, base: key, rarity: topTier });
    else setItem({ ...fresh, base: data.uniques.find((u) => u.id === key)!.base, unique: key, rarity: data.uniqueRarity.id });
  };

  return (
    <div style={{ '--rar': 'var(--ink)' } as CSSProperties}>
      <div className="title-row">
        <h1>Gear</h1>
        {reset}
      </div>
      <div className="gear-layout">
        <ul className="gear-slots">
          {GEAR_SLOTS.map((s) => {
            const worn = build.gear[s.id] && readItem(data, build.gear[s.id]!);
            return (
              <li key={s.id}>
                <button
                  className="gear-slot"
                  type="button"
                  aria-pressed={s.id === slot}
                  onClick={() => {
                    setSlot(s.id);
                    if (!worn) setChoosing(true);
                  }}
                >
                  {worn && spriteOf(worn) ? (
                    <img className="gear-sprite" src={spriteOf(worn)} alt="" width={32} height={32} />
                  ) : (
                    <GearIcon icon={(worn?.base ?? data.bases.find((b) => b.slot === s.icon)!).icon} />
                  )}
                  <span>
                    <span className="cap">{s.name}</span>
                    {worn ? (
                      <strong style={{ color: totals?.takenOff[s.id] ? '#ff6b5e' : worn.rarity.ink }}>{nameOf(worn)}</strong>
                    ) : (
                      <span className="open">Empty</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button className="gear-slot" type="button" aria-pressed={slot === 'codex'} onClick={() => setSlot('codex')}>
              <img className="socket-sprite" src={data.codex.icon} alt="" width={32} height={32} />
              <span>
                <span className="cap">Codex</span>
                {build.codex && data.codex.kinds.some((k) => k.id === build.codex!.id) ? (
                  <strong style={{ color: data.rarities.find((r) => r.id === build.codex!.rarity)?.ink }}>{data.codex.kinds.find((k) => k.id === build.codex!.id)!.name}</strong>
                ) : (
                  <span className="open">Empty</span>
                )}
              </span>
            </button>
          </li>
        </ul>

        <div className="gear-editor">
          {slot === 'codex' ? (
            <CodexEditor data={data} build={build} maxLevel={core.maxLevel} onChange={(codex) => change({ codex })} />
          ) : item && readItem(data, item) ? (
            <ItemEditor
              key={slot}
              data={data}
              item={item}
              rolls={rolls}
              maxLevel={core.maxLevel}
              needs={needs(item)}
              takenOff={totals?.takenOff[place!.id]}
              onChange={setItem} onSwap={() => setChoosing(true)} onRemove={() => setItem(undefined)} />
          ) : (
            <div className="empty-part">
              <p>Nothing in the {place!.name.toLowerCase()} slot.</p>
              <button className="btn primary" type="button" onClick={() => setChoosing(true)}>
                Choose an item
              </button>
            </div>
          )}
        </div>
      </div>

      {choosing && place && <Picker title={`Choose gear for the ${place.name.toLowerCase()} slot`} choices={choices()} onClose={() => setChoosing(false)} onPick={choose} />}
    </div>
  );
}

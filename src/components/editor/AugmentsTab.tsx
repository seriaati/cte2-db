import { useState } from 'react';
import { AUGMENT_SLOTS, exactly } from '../../lib/buildRules';
import { augmentCapacity, augmentCost } from '../../lib/statRules';
import { StatLines } from '../StatLine';
import { Info, Loading, Picker, Slot, useSection, type Choice, type TabProps } from './shared';
import { useTotals } from './totals';

export default function AugmentsTab({ build, change, rolls, reset }: TabProps) {
  const data = useSection('sockets');
  const totals = useTotals(build);
  const [picking, setPicking] = useState(false);
  if (!data || !totals) return <Loading />;

  const { level } = build;
  const placed = build.augments.flatMap((a) => {
    const aura = data.auras.find((x) => x.id === a.id);
    return aura ? [{ aura, roll: a.roll ?? 100 }] : [];
  });
  const set = (next: typeof placed) => change({ augments: next.map(({ aura, roll }) => ({ id: aura.id, roll: roll === 100 ? undefined : roll })) });
  const takes = (aura: (typeof data.auras)[number]) => augmentCost(totals.stats, aura);
  const reserved = placed.reduce((sum, p) => sum + takes(p.aura), 0);
  const capacity = augmentCapacity(totals.rules, totals.stats);
  const limits = totals.rules.defs.spirit_cost;

  const choices = (): Choice[] =>
    data.auras.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      part: { stats: a.stats, rolls: exactly(100), level },
      note: `Takes ${takes(a)} capacity`,
      off: a.minLevel > level ? `Needs level ${a.minLevel}` : placed.some((p) => p.aura === a) ? 'Already equipped' : undefined,
    }));

  return (
    <div className="plain">
      <div className="title-row">
        <h1>Augments</h1>
        <Info>
          <p>
            A character has {limits.base} augment capacity to begin with. Augment Capacity from the rest of the build raises it, up to {limits.max}, and stats that change what an augment
            costs are counted in what each one takes.
          </p>
        </Info>
        <span className={`count ${reserved > capacity ? 'over' : ''}`}>
          {reserved} / {capacity} capacity
        </span>
        {reset}
      </div>
      <ul className="slots augments">
        {Array.from({ length: AUGMENT_SLOTS }, (_, i) => {
          const entry = placed[i];
          if (!entry) return <Slot key={i} label={`Augment ${i + 1}`} onPick={() => setPicking(true)} />;
          return (
            <Slot
              key={i}
              label={`Takes ${takes(entry.aura)}`}
              name={
                <span className="socket-name">
                  <img className="socket-sprite" src={entry.aura.icon} alt="" width={24} height={24} />
                  {entry.aura.name}
                </span>
              }
              onRemove={() => set(placed.filter((_, j) => j !== i))}
              roll={rolls ? { value: entry.roll, min: 0, max: 100, onChange: (r) => set(placed.map((p, j) => (j === i ? { ...p, roll: r } : p))) } : undefined}
            >
              <StatLines stats={entry.aura.stats} rolls={exactly(entry.roll)} level={level} />
            </Slot>
          );
        })}
      </ul>
      {picking && <Picker title="Choose an augment" choices={choices()} onClose={() => setPicking(false)} onPick={(id) => change({ augments: [...build.augments, { id }] })} />}
    </div>
  );
}

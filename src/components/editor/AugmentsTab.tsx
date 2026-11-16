import { useState } from 'react';
import { AUGMENT_CAPACITY, AUGMENT_SLOTS, exactly } from '../../lib/buildRules';
import { StatLines } from '../StatLine';
import { Loading, Picker, Slot, useSection, type Choice, type TabProps } from './shared';

export default function AugmentsTab({ build, change, rolls }: TabProps) {
  const data = useSection('sockets');
  const [picking, setPicking] = useState(false);
  if (!data) return <Loading />;

  const { level } = build;
  const placed = build.augments.flatMap((a) => {
    const aura = data.auras.find((x) => x.id === a.id);
    return aura ? [{ aura, roll: a.roll ?? 100 }] : [];
  });
  const set = (next: typeof placed) => change({ augments: next.map(({ aura, roll }) => ({ id: aura.id, roll: roll === 100 ? undefined : roll })) });
  const reserved = placed.reduce((sum, p) => sum + p.aura.reserves, 0);

  const choices = (): Choice[] =>
    data.auras.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      part: { stats: a.stats, rolls: exactly(100), level },
      note: `Takes ${a.reserves} capacity`,
      off: a.minLevel > level ? `Needs level ${a.minLevel}` : placed.some((p) => p.aura === a) ? 'Already equipped' : undefined,
    }));

  return (
    <div className="plain">
      <div className="title-row">
        <h1>Augments</h1>
        <span className="count">{reserved} capacity used</span>
      </div>
      <p className="note">
        A character has {AUGMENT_CAPACITY} augment capacity to begin with. Talents and gear with Augment Capacity change that, which the editor doesn't add up yet.
      </p>
      <ul className="slots augments">
        {Array.from({ length: AUGMENT_SLOTS }, (_, i) => {
          const entry = placed[i];
          if (!entry) return <Slot key={i} label={`Augment ${i + 1}`} onPick={() => setPicking(true)} />;
          return (
            <Slot
              key={i}
              label={`Takes ${entry.aura.reserves}`}
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

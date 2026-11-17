import { useState, type CSSProperties } from 'react';
import { describeJewel, jewelSockets } from '../../lib/buildCalc';
import { MAX_JEWELS, exactly, type Jewel, type Rolled } from '../../lib/buildRules';
import { RaritySwatches } from '../controls';
import { StatLines } from '../StatLine';
import { Loading, NumberField, Picker, Slot, useSection, type Choice, type TabProps } from './shared';

export default function JewelsTab({ core, build, change, rolls, reset }: TabProps) {
  const data = useSection('sockets');
  const [picking, setPicking] = useState<{ jewel: number; pool: 'affix' | 'own' | 'corruption' } | 'kind' | null>(null);
  if (!data) return <Loading />;

  const { kinds, crafted, eye, affixes } = data.jewels;
  const sockets = jewelSockets(core, build);
  const setJewel = (index: number, jewel: Jewel | null) => change({ jewels: build.jewels.flatMap((j, i) => (i === index ? (jewel ?? []) : j)) });

  const kindChoices = (): Choice[] => [
    ...kinds.map((k) => ({ id: k.id, name: k.name, icon: k.icon })),
    ...[
      { id: 'crafted', ...crafted },
      { id: 'eye', ...eye },
    ].map((k) => ({ ...k, off: build.jewels.some((j) => j.kind === k.id) ? 'Only one can be socketed' : undefined })),
  ];

  const open = typeof picking === 'object' ? picking : null;
  const opened = open && build.jewels[open.jewel];
  const affixChoices = (): Choice[] => {
    const about = describeJewel(data, opened!);
    const pool = open!.pool === 'affix' ? about.pool : open!.pool === 'own' ? about.own : affixes.corruption;
    const taken = [...opened!.affixes, ...opened!.corruption].map((a) => a.id);
    return pool
      .filter((a) => !taken.includes(a.id))
      .map((a) => ({ id: a.id, name: a.aura ? `While ${a.aura} is on` : '', part: { stats: a.stats, rolls: exactly(about.best), level: opened!.level } }));
  };

  return (
    <div>
      <div className="title-row">
        <h1>Jewels</h1>
        <span className={`count ${build.jewels.length > sockets ? 'over' : ''}`}>
          {build.jewels.length} / {sockets} sockets
        </span>
        {reset}
      </div>
      <p className="note">Jewel sockets come from talents (search the talent tree for "Jewel Sockets") and from a few uniques, up to {MAX_JEWELS}.</p>

      <div className="jewels">
        {build.jewels.map((jewel, index) => {
          const about = describeJewel(data, jewel);
          const set = (patch: Partial<Jewel>) => setJewel(index, { ...jewel, ...patch });
          const rows = (label: string, pool: typeof affixes.jewel, count: number, key: 'affixes' | 'corruption', pick: 'affix' | 'own' | 'corruption') => {
            const placed = jewel[key].filter((a) => pool.some((x) => x.id === a.id)).slice(0, count);
            const others = jewel[key].filter((a) => !placed.includes(a));
            const put = (next: Rolled[]) => set({ [key]: [...others, ...next] });
            return Array.from({ length: count }, (_, i) => {
              const affix = placed[i] && pool.find((a) => a.id === placed[i].id)!;
              const name = `${label} ${i + 1}`;
              if (!affix) return <Slot key={pick + i} label={name} onPick={() => setPicking({ jewel: index, pool: pick })} />;
              const roll = placed[i].roll ?? about.best;
              return (
                <Slot
                  key={pick + i}
                  label={name}
                  name={affix.aura ? `While ${affix.aura} is on` : ''}
                  onRemove={() => put(placed.filter((_, j) => j !== i))}
                  roll={rolls ? { value: roll, min: 0, max: 100, onChange: (r) => put(placed.map((a, j) => (j === i ? { ...a, roll: r } : a))) } : undefined}
                >
                  <StatLines stats={affix.stats} rolls={exactly(roll)} level={jewel.level} />
                </Slot>
              );
            });
          };
          return (
            <section key={index} className="jewel" style={{ '--rar': about.rarity?.ink ?? 'var(--ink)' } as CSSProperties}>
              <div className="item-top">
                <div className="socket-name">
                  <img className="socket-sprite" src={about.item.icon} alt="" width={32} height={32} />
                  <div>
                    <div className="item-name rar">{about.item.name}</div>
                    <div className="cap">
                      {about.rarity?.name ?? 'Unique'} / Lv {jewel.level}
                    </div>
                  </div>
                </div>
                <button className="btn" type="button" onClick={() => setJewel(index, null)}>
                  Remove
                </button>
              </div>
              <div className="controls">
                {about.rarity && <RaritySwatches rarities={data.rarities} value={about.rarity.id} onChange={(id) => set({ rarity: id })} />}
                <NumberField label="Jewel level" value={jewel.level} min={1} max={core.maxLevel} onChange={(n) => set({ level: n })} />
              </div>
              <ul className="slots">
                {rows('Affix', about.pool, about.slots, 'affixes', 'affix')}
                {rows(jewel.kind === 'eye' ? 'Eye affix' : 'Affix', about.own, about.ownSlots, 'affixes', 'own')}
              </ul>
              <details className="more-part" open={jewel.corruption.length > 0}>
                <summary>
                  <span className="cap">Corruption</span>
                  {jewel.corruption.length > 0 && <span className="count">{jewel.corruption.length}</span>}
                </summary>
                <ul className="slots">{rows('Corruption', affixes.corruption, 2, 'corruption', 'corruption')}</ul>
              </details>
            </section>
          );
        })}
      </div>

      <div className="controls">
        <button className="btn primary" type="button" disabled={build.jewels.length >= MAX_JEWELS} onClick={() => setPicking('kind')}>
          Add a jewel
        </button>
      </div>

      {picking === 'kind' && (
        <Picker
          title="Choose a jewel"
          choices={kindChoices()}
          onClose={() => setPicking(null)}
          onPick={(id) => change({ jewels: [...build.jewels, { kind: id as Jewel['kind'], rarity: data.rarities.at(-1)!.id, level: build.level, affixes: [], corruption: [] }] })}
        />
      )}
      {open && opened && (
        <Picker
          title="Choose an affix"
          choices={affixChoices()}
          onClose={() => setPicking(null)}
          onPick={(id) => setJewel(open.jewel, { ...opened, [open.pool === 'corruption' ? 'corruption' : 'affixes']: [...opened[open.pool === 'corruption' ? 'corruption' : 'affixes'], { id }] })}
        />
      )}
    </div>
  );
}

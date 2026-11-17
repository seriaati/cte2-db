import { useState, type CSSProperties } from 'react';
import type { StatMod } from '../../lib/affix';
import { readCodex } from '../../lib/buildCalc';
import { RARITY_TYPES, codexBonuses, exactly, type Build, type Codex, type RarityType } from '../../lib/buildRules';
import type { Sections } from '../../lib/builds';
import { Dropdown, RaritySwatches } from '../controls';
import { StatLines } from '../StatLine';
import { NumberField, Picker, Slot, type Choice } from './shared';

type Gear = Sections['gear'];

const TYPE_NAMES: Record<RarityType, string> = { normal: 'Normal', unique: 'Unique', runed: 'Runed' };

interface Props {
  data: Gear;
  build: Build;
  maxLevel: number;
  onChange: (codex: Codex | null) => void;
}

export function CodexEditor({ data, build, maxLevel, onChange }: Props) {
  const [picking, setPicking] = useState<'kind' | 'affix' | null>(null);
  const read = readCodex(data, build);
  const tiers = data.rarities.filter((r) => !r.runewords);

  // A codex asks for a number of pieces its rarity allows.
  const fit = (pieces: Codex['pieces'], rarityId: string) => {
    const allowed = data.codex.rarities[rarityId].pieces;
    return Object.fromEntries(RARITY_TYPES.map((type) => [type, Math.min(allowed[type].max, Math.max(allowed[type].min, pieces[type]))])) as Codex['pieces'];
  };
  const kinds = (): Choice[] => data.codex.kinds.map((k) => ({ id: k.id, name: k.name, icon: data.codex.icon, part: { stats: k.mods, rolls: exactly(100), level: build.level } }));
  const chooseKind = (id: string) =>
    onChange(build.codex ? { ...build.codex, id, affixes: [] } : { id, rarity: tiers.at(-1)!.id, level: build.level, pieces: fit({ normal: 0, unique: 0, runed: 0 }, tiers.at(-1)!.id), slots: [], affixes: [] });

  if (!read) {
    return (
      <div className="empty-part">
        <p>No codex. A codex gives its stats while the rest of the gear is the mix of rarities it asks for.</p>
        <button className="btn primary" type="button" onClick={() => setPicking('kind')}>
          Choose a codex
        </button>
        {picking && <Picker title="Choose a codex" choices={kinds()} onClose={() => setPicking(null)} onPick={chooseKind} />}
      </div>
    );
  }

  const { codex, kind, rarity, limits, slots, percent, pool, affixes, worn } = read;
  const set = (patch: Partial<Codex>) => onChange({ ...codex, ...patch });
  const part = (stats: StatMod[]) => ({ stats, rolls: exactly(percent), level: codex.level });
  // Off-hand slots are never asked for (Omen.getRandomSlotReq).
  const slotOptions = [...new Set(data.bases.filter((b) => b.family !== 'OffHand').map((b) => b.slot))].map((id) => ({ value: id, label: data.slotNames[id] }));

  return (
    <div className="item-editor" style={{ '--rar': rarity.ink } as CSSProperties}>
      <div className="item-top">
        <div>
          <div className="item-name rar">{kind.name}</div>
          <div className="cap">
            {rarity.name} codex / Lv {codex.level} / stats at {percent}%
          </div>
        </div>
        <div className="item-buttons">
          <button className="btn" type="button" onClick={() => setPicking('kind')}>
            Change
          </button>
          <button className="btn" type="button" onClick={() => onChange(null)}>
            Remove
          </button>
        </div>
      </div>

      <div className="controls">
        <RaritySwatches rarities={tiers} value={rarity.id} onChange={(id) => set({ rarity: id, pieces: fit(codex.pieces, id) })} />
        <NumberField label="Codex level" value={codex.level} min={1} max={maxLevel} onChange={(n) => set({ level: n })} />
      </div>

      <section className="group">
        <div className="group-head">
          <h2>Asks for</h2>
        </div>
        <div className="controls part-controls">
          {RARITY_TYPES.map((type) => (
            <NumberField
              key={type}
              label={`${TYPE_NAMES[type]} pieces`}
              value={codex.pieces[type]}
              min={limits.pieces[type].min}
              max={limits.pieces[type].max}
              onChange={(n) => set({ pieces: { ...codex.pieces, [type]: n } })}
            />
          ))}
        </div>
        {slots.map((req, i) => (
          <div key={i} className="controls part-controls">
            <Dropdown label="Slot" value={req.slot} groups={[{ options: slotOptions }]} onChange={(id) => set({ slots: slots.map((s, j) => (j === i ? { ...s, slot: id } : s)) })} />
            <Dropdown
              label="Has to be"
              value={req.type}
              groups={[{ options: RARITY_TYPES.map((type) => ({ value: type, label: TYPE_NAMES[type] })) }]}
              onChange={(type) => set({ slots: slots.map((s, j) => (j === i ? { ...s, type: type as RarityType } : s)) })}
            />
            <button className="btn remove" type="button" aria-label="Remove slot condition" onClick={() => set({ slots: slots.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        {slots.length < limits.slots && (
          <div className="controls part-controls">
            <button className="btn" type="button" onClick={() => set({ slots: [...slots, { slot: slotOptions.find((o) => !slots.some((s) => s.slot === o.value))!.value, type: 'normal' }] })}>
              Add a slot condition
            </button>
          </div>
        )}
      </section>

      <section className="group">
        <div className="group-head">
          <h2>Affixes</h2>
          <span className="count">
            {affixes.length}/{limits.affixes}
          </span>
        </div>
        <ul className="slots">
          {Array.from({ length: limits.affixes }, (_, i) => {
            const affix = affixes[i];
            if (!affix) return <Slot key={i} label={`Affix ${i + 1}`} onPick={() => setPicking('affix')} />;
            return (
              <Slot key={i} label={`Affix ${i + 1}`} name={affix.name} onRemove={() => set({ affixes: affixes.filter((_, j) => j !== i).map((a) => a.id) })}>
                <StatLines {...part(affix.stats)} />
              </Slot>
            );
          })}
        </ul>
      </section>

      <section className="group">
        <div className="group-head">
          <h2>Gives</h2>
          <span className="pool">The gear worn counts as {worn} pieces</span>
        </div>
        <ul className="slots">
          {codexBonuses(codex, kind.mods, affixes).map((bonus) => (
            <li key={bonus.pieces} className={`slot filled ${worn >= bonus.pieces ? '' : 'unmet'}`}>
              <span className="name">
                <span className="cap">{bonus.pieces} pieces</span>
              </span>
              <span className="stats">
                {bonus.mods && <StatLines {...part(bonus.mods)} />}
                {bonus.affix && <StatLines {...part(bonus.affix.stats)} />}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {picking === 'kind' && <Picker title="Choose a codex" choices={kinds()} onClose={() => setPicking(null)} onPick={chooseKind} />}
      {picking === 'affix' && (
        <Picker
          title="Choose an affix"
          choices={pool.filter((a) => !affixes.includes(a)).map((a) => ({ id: a.id, name: a.name, part: part(a.stats) }))}
          onClose={() => setPicking(null)}
          onPick={(id) => set({ affixes: [...affixes.map((a) => a.id), id] })}
        />
      )}
    </div>
  );
}

import { useState, type CSSProperties } from 'react';
import type { StatMod } from '../../lib/affix';
import { RARITY_TYPES, codexBonuses, codexPercent, exactly, type Build, type Codex, type RarityType } from '../../lib/buildRules';
import type { Sections } from '../../lib/builds';
import { Dropdown, RaritySwatches } from '../controls';
import { StatLines } from '../StatLine';
import { NumberField, Picker, Slot, type Choice } from './shared';

type Gear = Sections['gear'];

const TYPE_NAMES: Record<RarityType, string> = { normal: 'Normal', unique: 'Unique', runed: 'Runed' };

// OmenData.calcPiecesEquipped: a worn item counts toward its kind of rarity until the codex has
// enough of that kind, unless the codex wants its slot to hold another kind.
function piecesWorn(data: Gear, build: Build, codex: Codex) {
  const counted: Record<string, number> = {};
  for (const item of Object.values(build.gear)) {
    const base = data.bases.find((b) => b.id === item.base);
    const type = data.rarityTypes[item.unique ? data.uniqueRarity.id : item.rarity];
    if (!base || !type || codex.slots.some((req) => req.slot === base.slot && req.type !== type)) continue;
    if ((counted[type] ?? 0) < codex.pieces[type]) counted[type] = (counted[type] ?? 0) + 1;
  }
  return Object.values(counted).reduce((sum, n) => sum + n, 0);
}

interface Props {
  data: Gear;
  build: Build;
  maxLevel: number;
  onChange: (codex: Codex | null) => void;
}

export function CodexEditor({ data, build, maxLevel, onChange }: Props) {
  const [picking, setPicking] = useState<'kind' | 'affix' | null>(null);
  const { codex } = build;
  const kind = codex && data.codex.kinds.find((k) => k.id === codex.id);
  const tiers = data.rarities.filter((r) => !r.runewords);

  // A codex asks for a number of pieces its rarity allows.
  const fit = (pieces: Codex['pieces'], rarityId: string) => {
    const allowed = data.codex.rarities[rarityId].pieces;
    return Object.fromEntries(RARITY_TYPES.map((type) => [type, Math.min(allowed[type].max, Math.max(allowed[type].min, pieces[type]))])) as Codex['pieces'];
  };
  const kinds = (): Choice[] => data.codex.kinds.map((k) => ({ id: k.id, name: k.name, icon: data.codex.icon, part: { stats: k.mods, rolls: exactly(100), level: build.level } }));
  const chooseKind = (id: string) =>
    onChange(codex ? { ...codex, id, affixes: [] } : { id, rarity: tiers.at(-1)!.id, level: build.level, pieces: fit({ normal: 0, unique: 0, runed: 0 }, tiers.at(-1)!.id), slots: [], affixes: [] });

  if (!codex || !kind) {
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

  const rarity = tiers.find((r) => r.id === codex.rarity) ?? tiers.at(-1)!;
  const limits = data.codex.rarities[rarity.id];
  const set = (patch: Partial<Codex>) => onChange({ ...codex, ...patch });
  const percent = codexPercent({ ...codex, slots: codex.slots.slice(0, limits.slots) }, limits.statMulti);
  const part = (stats: StatMod[]) => ({ stats, rolls: exactly(percent), level: codex.level });
  const pool = data.codex.affixes.filter((a) => kind.affixTypes.includes(a.type));
  const affixes = codex.affixes.flatMap((id) => pool.find((a) => a.id === id) ?? []).slice(0, limits.affixes);
  const worn = piecesWorn(data, build, codex);
  const slots = codex.slots.slice(0, limits.slots);
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

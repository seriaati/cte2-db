import { useState, type CSSProperties } from 'react';
import { canRoll, formatRange, type StatMod } from '../../lib/affix';
import { exactly, rollIn, type Item, type Rolled } from '../../lib/buildRules';
import type { Sections } from '../../lib/builds';
import { baseRange, formedRuneword, itemName, rollWindows, slotCount, type Part } from '../../lib/plannerRules';
import { Dropdown, RaritySwatches } from '../controls';
import { socketPart, type Socketed } from '../planner/Sockets';
import { StatLine, StatLines } from '../StatLine';
import { NumberField, Picker, Slot, type Choice } from './shared';

type Gear = Sections['gear'];

// The parts of an item that game data still knows, with what each gives at its roll.
export function readItem(data: Gear, item: Item) {
  const base = data.bases.find((b) => b.id === item.base);
  if (!base) return null;
  const unique = data.uniques.find((u) => u.id === item.unique && u.base === base.id);
  const tiers = data.rarities.filter((r) => !r.runewords);
  const rarity = unique ? data.uniqueRarity : (data.rarities.find((r) => r.id === item.rarity) ?? tiers.at(-1)!);
  const rollable = data.affixes.filter((a) => canRoll(a, base));
  const implicits = rollable.filter((a) => a.type === 'implicit');
  const affixes = (type: 'prefix' | 'suffix') =>
    item[type].flatMap((placed) => rollable.find((a) => a.id === placed.id && a.type === type) ?? []).slice(0, slotCount(rarity, type));
  const kind = data.corruption.kinds.find((k) => k.id === item.corruption?.kind && k.rarities.includes(rarity.id));
  const kept = { gem: 0, rune: 0 };
  const sockets = item.sockets
    .flatMap((s): (Socketed & { roll?: number })[] => {
      const found = s.kind === 'gem' ? data.gems.find((g) => g.id === s.id) : data.runes.find((r) => r.id === s.id);
      return found ? [{ kind: s.kind, item: found, roll: s.roll } as Socketed & { roll?: number }] : [];
    })
    .slice(0, rarity.sockets + (kind?.sockets ?? 0))
    .filter((s) => kept[s.kind]++ < (s.kind === 'gem' ? rarity.maxGems : rarity.maxRunes));
  const runes = sockets.filter((s) => s.kind === 'rune').map((s) => s.item.id);
  const infusion = data.infusions.find((a) => a.id === item.infusion?.id && canRoll(a, base));
  return {
    base,
    unique,
    rarity,
    tiers,
    rollable,
    implicits,
    // A drop always has an implicit when its base has any, uniques included (GearCreationUtils).
    implicit: implicits.find((a) => a.id === item.implicit?.id) ?? implicits[0],
    prefix: affixes('prefix'),
    suffix: affixes('suffix'),
    kind,
    corrupted: kind ? item.corruption!.affixes.flatMap((placed) => data.corruption.affixes.find((a) => a.id === placed.id && canRoll(a, base)) ?? []).slice(0, kind.affixes) : [],
    sockets,
    socketCount: rarity.sockets + (kind?.sockets ?? 0),
    runeword: rarity.runewords ? formedRuneword(data.runewords, runes, base.slot) : undefined,
    infusion,
    infusionRarity: tiers.find((r) => r.id === item.infusion?.rarity) ?? tiers.at(-1)!,
    enchants: item.enchants.flatMap((e) => {
      const enchant = data.enchants.find((x) => x.id === e.id);
      return enchant ? [{ ...enchant, level: e.level }] : [];
    }),
  };
}

export const nameOf = (parts: NonNullable<ReturnType<typeof readItem>>) =>
  parts.unique?.name ?? itemName(parts.base, parts.implicit, parts.prefix[0], parts.suffix[0]);

// The item's picture; empty for the two vanilla items the pack has no picture of.
export const spriteOf = (parts: NonNullable<ReturnType<typeof readItem>>) => parts.unique?.sprite ?? parts.base.sprites[parts.rarity.id];

// What an enchantment gives at a level: a fixed amount per level, up to the cap for one item.
const enchantValue = (enchant: Gear['enchants'][number], level: number) => Math.min(enchant.itemMax, Math.max(enchant.itemMin, enchant.stat.min * level));

interface Props {
  data: Gear;
  item: Item;
  rolls: boolean;
  maxLevel: number;
  onChange: (item: Item) => void;
  onSwap: () => void;
  onRemove: () => void;
}

const TITLES = {
  implicit: 'Choose an implicit',
  prefix: 'Choose a prefix',
  suffix: 'Choose a suffix',
  socket: 'Choose what to socket',
  infusion: 'Choose an infusion',
  corruption: 'Choose a corruption affix',
  enchant: 'Choose an enchantment',
};
type Picking = { part: keyof typeof TITLES };

export function ItemEditor({ data, item, rolls, maxLevel, onChange, onSwap, onRemove }: Props) {
  const [picking, setPicking] = useState<Picking | null>(null);
  const parts = readItem(data, item)!;
  const { base, unique, rarity, tiers, implicit, kind, sockets, runeword, infusion, infusionRarity } = parts;
  const { level } = item;
  const windows = rollWindows(rarity);
  // An affix can be of any tier up to the item's rarity, so it rolls anywhere below that rarity's best.
  const affixWindow = { minPercent: 0, maxPercent: rarity.maxPercent };
  const whole = { minPercent: 0, maxPercent: 100 };
  const set = (patch: Partial<Item>) => onChange({ ...item, ...patch });

  const at = (stats: StatMod[], percent: number, partLevel = level): Part => ({ stats, rolls: exactly(percent), level: partLevel });
  const rollOf = (placed: Rolled | undefined, window = affixWindow) => rollIn(placed?.roll, window);
  const socketed = (s: (typeof sockets)[number]) => socketPart(s, base, exactly(rollIn(s.roll, whole)), level);

  const basePart = at(base.stats, rollIn(item.baseRoll, windows.base));
  const others: Part[] = [
    ...(unique ? unique.stats.map((stat, i) => at([stat], item.uniqueRolls?.[i] ?? 100)) : []),
    ...(implicit ? [at(implicit.stats, rollOf(item.implicit, whole))] : []),
    ...(['prefix', 'suffix'] as const).flatMap((type) => parts[type].map((a, i) => at(a.stats, rollOf(item[type][i])))),
    ...sockets.map(socketed),
    ...(runeword ? [at(runeword.stats, rollIn(item.runewordRoll, whole))] : []),
    ...(infusion ? [at(infusion.stats, infusionRarity.maxPercent)] : []),
    ...parts.corrupted.map((a, i) => at(a.stats, rollOf(item.corruption!.affixes[i], whole))),
  ];

  // The roll box of a slot, shown only while rolls are being set.
  const rollBox = (value: number, window: { minPercent: number; maxPercent: number }, onRoll: (roll: number) => void) =>
    rolls ? { value, min: window.minPercent, max: window.maxPercent, onChange: onRoll } : undefined;
  const rerolled = (list: Rolled[], index: number, roll: number) => list.map((placed, i) => (i === index ? { ...placed, roll } : placed));

  const changeRarity = (id: string) => {
    const next = data.rarities.find((r) => r.id === id)!;
    set({ rarity: id, prefix: item.prefix.slice(0, slotCount(next, 'prefix')), suffix: item.suffix.slice(0, slotCount(next, 'suffix')) });
  };

  const best = (stats: StatMod[], window = affixWindow) => at(stats, window.maxPercent);
  const choices = (): Choice[] => {
    switch (picking!.part) {
      case 'implicit':
        return parts.implicits.map((a) => ({ id: a.id, name: a.name, part: best(a.stats, whole) }));
      case 'prefix':
      case 'suffix': {
        const type = picking!.part;
        return parts.rollable.filter((a) => a.type === type && (a.repeatable || !parts[type].includes(a))).map((a) => ({ id: a.id, name: a.name, part: best(a.stats) }));
      }
      case 'infusion':
        return data.infusions.filter((a) => canRoll(a, base)).map((a) => ({ id: a.id, name: '', part: at(a.stats, infusionRarity.maxPercent) }));
      case 'corruption':
        return data.corruption.affixes.filter((a) => canRoll(a, base) && !parts.corrupted.includes(a)).map((a) => ({ id: a.id, name: a.name, part: best(a.stats, whole) }));
      case 'enchant':
        return data.enchants.filter((e) => !item.enchants.some((x) => x.id === e.id)).map((e) => ({ id: e.id, name: e.name, part: at([e.stat], 100, 1), note: 'for each level' }));
      case 'socket': {
        const count = (kind: Socketed['kind']) => sockets.filter((s) => s.kind === kind).length;
        const rune = (id: string) => data.runes.find((r) => r.id === id)!;
        return [
          ...(rarity.runewords
            ? data.runewords
                .filter((w) => w.slots.includes(base.slot) && w.runes.length <= parts.socketCount)
                .map((w) => ({ id: `word:${w.id}`, name: w.name, group: 'Runewords', part: best(w.stats, whole), note: w.runes.map((id) => rune(id).name.replace(' Rune', '')).join(' · ') }))
            : []),
          ...(count('rune') < rarity.maxRunes
            ? data.runes
                .filter((r) => !sockets.some((s) => s.item === r))
                .map((r) => ({ id: `rune:${r.id}`, name: r.name, icon: r.icon, group: 'Runes', part: socketPart({ kind: 'rune', item: r }, base, exactly(100), level) }))
            : []),
          ...(count('gem') < rarity.maxGems
            ? [...data.ranks]
                .reverse()
                .flatMap((rank) =>
                  data.gems
                    .filter((g) => g.tier === rank.tier)
                    .map((g) => ({ id: `gem:${g.id}`, name: g.name, icon: g.icon, group: `${rank.name} gems`, part: socketPart({ kind: 'gem', item: g }, base, exactly(100), level) })),
                )
            : []),
        ];
      }
    }
  };

  const pick = (id: string) => {
    switch (picking!.part) {
      case 'implicit':
        return set({ implicit: { id } });
      case 'prefix':
      case 'suffix':
        return set({ [picking!.part]: [...item[picking!.part], { id }] });
      case 'infusion':
        return set({ infusion: { id, rarity: infusionRarity.id } });
      case 'corruption':
        return set({ corruption: { kind: kind!.id, affixes: [...item.corruption!.affixes, { id }] } });
      case 'enchant':
        return set({ enchants: [...item.enchants, { id, level: 1 }] });
      case 'socket': {
        const [type, key] = id.split(/:(.*)/);
        // Picking a runeword sockets its runes, in order, in place of what was there.
        if (type === 'word') return set({ sockets: data.runewords.find((w) => w.id === key)!.runes.map((rune) => ({ kind: 'rune', id: rune })) });
        return set({ sockets: [...item.sockets, { kind: type as 'gem' | 'rune', id: key }] });
      }
    }
  };

  const affixSlots = (type: 'prefix' | 'suffix') =>
    Array.from({ length: slotCount(rarity, type) }, (_, i) => {
      const affix = parts[type][i];
      const label = `${type === 'prefix' ? 'Prefix' : 'Suffix'} ${i + 1}`;
      if (!affix) return <Slot key={type + i} label={label} onPick={() => setPicking({ part: type })} />;
      const roll = rollOf(item[type][i]);
      return (
        <Slot
          key={type + i}
          label={label}
          name={affix.name}
          onRemove={() => set({ [type]: item[type].filter((_, j) => j !== i) })}
          roll={rollBox(roll, affixWindow, (r) => set({ [type]: rerolled(item[type], i, r) }))}
        >
          <StatLines {...at(affix.stats, roll)} />
        </Slot>
      );
    });

  const named = (socket: { icon: string; name: string }) => (
    <span className="socket-name">
      <img className="socket-sprite" src={socket.icon} alt="" width={24} height={24} />
      {socket.name}
    </span>
  );

  return (
    <div className="item-editor" style={{ '--rar': rarity.ink } as CSSProperties}>
      <div className="item-top">
        <div className="item-title">
          {spriteOf(parts) && <img className="gear-sprite" src={spriteOf(parts)} alt="" width={64} height={64} />}
          <div>
            <div className="item-name rar">{nameOf(parts)}</div>
            <div className="cap">
              {rarity.name} {base.name} / Lv {level}
            </div>
          </div>
        </div>
        <div className="item-buttons">
          <button className="btn" type="button" onClick={onSwap}>
            Change
          </button>
          <button className="btn" type="button" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      <div className="controls">
        {!unique && <RaritySwatches rarities={data.rarities} value={rarity.id} onChange={changeRarity} />}
        <NumberField label="Item level" value={level} min={1} max={maxLevel} onChange={(n) => set({ level: n })} />
      </div>

      <ul className="slots">
        {base.stats.length > 0 && (
          <Slot label="Base" name={base.name} roll={rollBox(rollIn(item.baseRoll, windows.base), windows.base, (r) => set({ baseRoll: r }))}>
            {base.stats.map((stat, i) => (
              <span key={i} className="line">
                <StatLine line={formatRange(stat, ...baseRange(stat, basePart, others))} />
              </span>
            ))}
          </Slot>
        )}
        {unique &&
          (rolls ? (
            unique.stats.map((stat, i) => {
              const roll = item.uniqueRolls?.[i] ?? 100;
              const onRoll = (r: number) => set({ uniqueRolls: unique.stats.map((_, j) => (j === i ? r : (item.uniqueRolls?.[j] ?? 100))) });
              return (
                <Slot key={i} label={`Unique stat ${i + 1}`} name="" roll={rollBox(roll, whole, onRoll)}>
                  <StatLines {...at([stat], roll)} />
                </Slot>
              );
            })
          ) : (
            <Slot label="Unique stats" name="">
              {unique.stats.map((stat, i) => (
                <StatLines key={i} {...at([stat], item.uniqueRolls?.[i] ?? 100)} />
              ))}
            </Slot>
          ))}
        {implicit && (
          <Slot
            label="Implicit"
            name={implicit.name}
            onPick={parts.implicits.length > 1 ? () => setPicking({ part: 'implicit' }) : undefined}
            roll={rollBox(rollOf(item.implicit, whole), whole, (r) => set({ implicit: { id: implicit.id, roll: r } }))}
          >
            <StatLines {...at(implicit.stats, rollOf(item.implicit, whole))} />
          </Slot>
        )}
        {affixSlots('prefix')}
        {affixSlots('suffix')}
        {Array.from({ length: parts.socketCount }, (_, i) => {
          const socket = sockets[i];
          if (!socket) return <Slot key={`socket${i}`} label={`Socket ${i + 1}`} onPick={() => setPicking({ part: 'socket' })} />;
          const reroll = (r: number) => set({ sockets: sockets.map((s, j) => ({ kind: s.kind, id: s.item.id, roll: j === i ? r : s.roll })) });
          return (
            <Slot
              key={`socket${i}`}
              label={`Socket ${i + 1}`}
              name={named(socket.item)}
              onRemove={() => set({ sockets: sockets.filter((_, j) => j !== i).map((s) => ({ kind: s.kind, id: s.item.id, roll: s.roll })) })}
              roll={socket.kind === 'rune' ? rollBox(rollIn(socket.roll, whole), whole, reroll) : undefined}
            >
              <StatLines {...socketed(socket)} />
            </Slot>
          );
        })}
        {runeword && (
          <Slot label="Runeword" name={runeword.name} roll={rollBox(rollIn(item.runewordRoll, whole), whole, (r) => set({ runewordRoll: r }))}>
            <StatLines {...at(runeword.stats, rollIn(item.runewordRoll, whole))} />
          </Slot>
        )}
        {infusion ? (
          <Slot label="Infusion" name={<span style={{ color: infusionRarity.ink }}>{infusionRarity.name}</span>} onRemove={() => set({ infusion: undefined })}>
            <span style={{ '--rar': infusionRarity.ink } as CSSProperties}>
              <StatLines {...at(infusion.stats, infusionRarity.maxPercent)} />
            </span>
          </Slot>
        ) : (
          data.infusions.some((a) => canRoll(a, base)) && <Slot label="Infusion" onPick={() => setPicking({ part: 'infusion' })} />
        )}
      </ul>
      {infusion && (
        <div className="controls part-controls">
          <RaritySwatches label="Infusion rarity" rarities={tiers} value={infusionRarity.id} onChange={(id) => set({ infusion: { id: infusion.id, rarity: id } })} />
        </div>
      )}

      <details className="more-part" open={!!kind}>
        <summary>
          <span className="cap">Corruption</span>
          {kind && <span className="count">{parts.corrupted.length}</span>}
        </summary>
        <div className="controls part-controls">
          <Dropdown
            label="What the corruption did"
            value={kind?.id ?? ''}
            groups={[
              {
                options: [
                  { value: '', label: 'Not corrupted' },
                  ...data.corruption.kinds
                    .filter((k) => k.rarities.includes(rarity.id))
                    .map((k) => ({ value: k.id, label: `${k.name}: ${k.affixes} ${k.affixes > 1 ? 'affixes' : 'affix'}${k.sockets ? ` and ${k.sockets} more socket` : ''}` })),
                ],
              },
            ]}
            onChange={(id) => set({ corruption: id ? { kind: id, affixes: (item.corruption?.affixes ?? []).slice(0, data.corruption.kinds.find((k) => k.id === id)!.affixes) } : undefined })}
          />
        </div>
        {kind && (
          <ul className="slots">
            {Array.from({ length: kind.affixes }, (_, i) => {
              const affix = parts.corrupted[i];
              const label = `Corruption ${i + 1}`;
              if (!affix) return <Slot key={i} label={label} onPick={() => setPicking({ part: 'corruption' })} />;
              const affixes = item.corruption!.affixes;
              const roll = rollOf(affixes[i], whole);
              return (
                <Slot
                  key={i}
                  label={label}
                  name={affix.name}
                  onRemove={() => set({ corruption: { kind: kind.id, affixes: affixes.filter((_, j) => j !== i) } })}
                  roll={rollBox(roll, whole, (r) => set({ corruption: { kind: kind.id, affixes: rerolled(affixes, i, r) } }))}
                >
                  <StatLines {...at(affix.stats, roll)} />
                </Slot>
              );
            })}
          </ul>
        )}
      </details>

      <details className="more-part" open={parts.enchants.length > 0}>
        <summary>
          <span className="cap">Enchantments</span>
          {parts.enchants.length > 0 && <span className="count">{parts.enchants.length}</span>}
        </summary>
        <ul className="slots">
          {parts.enchants.map((enchant) => {
            const value = enchantValue(enchant, enchant.level);
            // Levels past the cap for one item add nothing.
            const top = Math.ceil(Math.max(Math.abs(enchant.itemMin), Math.abs(enchant.itemMax)) / Math.abs(enchant.stat.min));
            return (
              <li key={enchant.id} className="slot filled">
                <span className="name">
                  <span className="cap">Enchantment</span>
                  {enchant.name}
                </span>
                <span className="stats">
                  <StatLine line={formatRange(enchant.stat, value, value)} />
                </span>
                <span className="slot-tools">
                  <label className="roll">
                    Lv
                    <input
                      className="in"
                      type="number"
                      min={1}
                      max={top}
                      value={enchant.level}
                      aria-label={`${enchant.name} level`}
                      onChange={(e) => set({ enchants: item.enchants.map((x) => (x.id === enchant.id ? { ...x, level: Math.min(top, Math.max(1, Math.trunc(e.target.valueAsNumber) || 1)) } : x)) })}
                    />
                  </label>
                  <button className="btn remove" type="button" aria-label={`Remove ${enchant.name}`} onClick={() => set({ enchants: item.enchants.filter((x) => x.id !== enchant.id) })}>
                    ×
                  </button>
                </span>
              </li>
            );
          })}
          <Slot label="Enchantment" onPick={() => setPicking({ part: 'enchant' })} />
        </ul>
      </details>

      {picking && <Picker title={TITLES[picking.part]} choices={choices()} onClose={() => setPicking(null)} onPick={pick} />}
    </div>
  );
}

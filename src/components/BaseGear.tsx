import { useEffect } from 'react';
import { formatStat, type Rarity } from '../lib/affix';
import type { BaseGear as Base } from '../lib/bases';
import { rollWindows, type PlanRarity } from '../lib/plannerRules';
import { GearIcon, LevelStepper, RaritySwatches } from './controls';
import { StatLine } from './StatLine';
import { useStored } from '../lib/useStored';

interface Props {
  bases: Base[];
  rarities: PlanRarity[];
  tagNames: Record<string, string>;
  reqScaling: { base: number; perLevel: number };
  maxLevel: number;
}

const ARMOR_SLOTS = ['helmet', 'chest', 'pants', 'boots'];

export default function BaseGear({ bases, rarities, tagNames, reqScaling, maxLevel }: Props) {
  const [rarityId, setRarityId] = useStored('rarity', rarities.at(-1)!.id);
  const [level, setLevel] = useStored('level', maxLevel);
  const rarity = rarities.find((r) => r.id === rarityId) ?? rarities.at(-1)!;
  const rolls = rollWindows(rarity).base;

  useEffect(() => {
    document.documentElement.style.setProperty('--rar', rarity.ink);
  }, [rarity]);

  // Mirrors StatRequirement.getScalingReq: the share of the requirement curve at the item's level, rounded down.
  const needs = (base: Base) =>
    base.needs.map((n) => (
      <div key={n.name}>
        {Math.floor(n.factor * (reqScaling.base + reqScaling.perLevel * (level - 1)))} {n.name}
      </div>
    ));
  const stats = (base: Base) => base.stats.map((s, i) => <div key={i}>{<StatLine line={formatStat(s, rolls, level)} />}</div>);

  const family = (id: string) => bases.filter((b) => b.family === id);
  const armor = family('Armor');
  const materials = [...new Set(armor.map((b) => b.id.slice(0, -b.slot.length - 1)))];
  const slotIcon = (slot: string) => armor.find((b) => b.slot === slot)!.icon;
  const plain = bases.filter((b) => !b.stats.length);

  return (
    <div className="content">
      <div className="title-row">
        <h1>Base gear</h1>
        <span className="context">
          <span className="rar">{rarity.name}</span> / Lv {level}
        </span>
      </div>
      <p className="lead">What each piece of gear gives before any affix, and the attributes you need to equip it.</p>

      <div className="controls">
        <LevelStepper value={level} max={maxLevel} onChange={setLevel} />
        <RaritySwatches rarities={rarities} value={rarityId} onChange={setRarityId} />
      </div>

      <p className="note">
        Base stats roll together: one roll between {rolls.minPercent}% and {rolls.maxPercent}% of each range at{' '}
        {rarity.name}, and flat values grow with item level. Requirements depend on item level only.
      </p>

      <section className="group">
        <div className="group-head">
          <h2>Armor</h2>
          <span className="count">{armor.length}</span>
        </div>
        <div className="row armor head cap" aria-hidden="true">
          <span>Material</span>
          <span>Needs</span>
          {ARMOR_SLOTS.map((slot) => (
            <span key={slot} className="slot-head">
              <GearIcon icon={slotIcon(slot)} />
              {tagNames[slot]}
            </span>
          ))}
        </div>
        <ul>
          {materials.map((material) => {
            const pieces = ARMOR_SLOTS.map((slot) => armor.find((b) => b.id === `${material}_${slot}`)!);
            return (
              <li key={material} className="row armor">
                <span className="name">{tagNames[material]}</span>
                <div className="needs">{needs(pieces[0])}</div>
                {pieces.map((piece) => (
                  <div key={piece.id} className="stats">
                    <div className="cap slot-cap">{tagNames[piece.slot]}</div>
                    {stats(piece)}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      {[
        { id: 'Weapon', label: 'Weapons' },
        { id: 'OffHand', label: 'Off-hand' },
      ].map((group) => (
        <section key={group.id} className="group">
          <div className="group-head">
            <h2>{group.label}</h2>
            <span className="count">{family(group.id).length}</span>
          </div>
          <div className="row base head cap" aria-hidden="true">
            <span>Name</span>
            <span>Base stats</span>
            <span>Needs</span>
          </div>
          <ul>
            {family(group.id).map((base) => (
              <li key={base.id} className="row base">
                <span className="name base-name">
                  <GearIcon icon={base.icon} />
                  {base.name}
                  {base.tags.includes('two_handed') && <span className="tag">{tagNames.two_handed}</span>}
                </span>
                <div className="stats">{stats(base)}</div>
                <div className="needs">{needs(base)}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="note">No base stats or requirements: {plain.map((b) => b.name).join(', ')}.</p>
    </div>
  );
}

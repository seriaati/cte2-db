import { useMemo } from 'react';
import { buildDamage } from '../../lib/buildCalc';
import { RESISTS, type Build } from '../../lib/buildRules';
import { ELEMENTS, type ByElement, type SkillHit } from '../../lib/damageRules';
import { Dropdown } from '../controls';
import { AuraField, Info, Loading, NumberField, Popover, RetributionField, useSection, type TabProps } from './shared';
import { useData } from './totals';

const show = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en') : `${+n.toFixed(1)}`);
const sum = (damage: ByElement) => Object.values(damage).reduce((total, value) => total + value, 0);
const elementName = (id: string) => Object.values(ELEMENTS).find((element) => element.id === id)!.name;
const WHEN: Record<SkillHit['when'], string> = {
  cast: 'when cast',
  hit: 'when a projectile hits',
  tick: 'over time',
  end: 'as it ends',
  attack: 'when a pet attacks',
  spell: 'when a pet casts its spell',
  aura: 'a second',
};

// What the skill picked on this tab deals, for the tab and for the summary beside the editor. Null
// until the game data it draws on has arrived.
export function useDamage(build: Build) {
  const damage = useSection('damage');
  const data = useData();
  return useMemo(() => (damage && data ? buildDamage({ ...data, damage }, build) : null), [damage, data, build]);
}

export default function DamageTab({ core, build, change }: TabProps) {
  const found = useDamage(build);
  if (!found) return <Loading />;

  const { rules, own, choices, chosen, variants, under, enemy, damage, aura, dps, elements, stats, crit, retribution } = found;
  // A summon skill is used by its pets, one attack at a time.
  const casts = chosen && damage.pets === undefined;
  const { level } = build;
  const { target } = build.damage;
  const left = rules.situational.filter((id) => stats.get(id)?.value || (stats.get(id)?.more ?? 1) !== 1).map((id) => own.rules.defs[id].name.replace('[VAL1]', 'X'));

  const set = (patch: Partial<Build['damage']>) => change({ damage: { ...build.damage, ...patch } });
  const aim = (patch: Partial<Build['damage']['target']>) => set({ target: { ...target, ...patch } });

  return (
    <div className="plain">
      <div className="title-row">
        <h1>Damage</h1>
        <Info>
          <p>
            What one skill deals a second to a single enemy when it is used over and over. Of projectiles shot together one is taken to hit, and what goes on over time lands every time. A
            summon skill deals what its pets do: as many as it can keep out, all attacking that enemy without pause. Critical hits and other chances count as their average.
          </p>
          <p>
            The target has no dodge or block, and neither side has buffs, curses or ailments on it but what the aura set to be on gives. Ailments and the damage they deal over time, and
            spells set off by other effects, aren't worked out yet.
          </p>
        </Info>
      </div>

      <div className="controls">
        <Dropdown
          label="Skill"
          value={chosen?.perk.id ?? ''}
          groups={[{ options: [{ value: '', label: 'Basic attack' }, ...choices.map((c) => ({ value: c.perk.id, label: c.spell.name, icon: c.perk.icon }))] }]}
          onChange={(skill) => set({ skill, under: '' })}
        />
        {variants.length > 1 && (
          <Dropdown label="Used with" value={under.name} groups={[{ options: variants.map((v) => ({ value: v.name, label: v.name || 'No effect' })) }]} onChange={(name) => set({ under: name })} />
        )}
        {retribution.spends && <RetributionField build={build} change={change} />}
        <AuraField build={build} change={change} />
        {!chosen && (
          <label className="field number">
            <span className="cap">Attacks a second</span>
            <span className="number-box">
              <input
                className="in"
                type="number"
                min={0.1}
                max={20}
                step={0.1}
                value={+damage.rate.toFixed(2)}
                // Emptied, it goes back to the weapon's own speed.
                onChange={(e) => set({ attacks: e.target.valueAsNumber > 0 ? Math.min(20, e.target.valueAsNumber) : undefined })}
              />
            </span>
          </label>
        )}
        <Popover label="Target">
          <NumberField label="Level" value={enemy.level} min={1} max={core.maxLevel} onChange={(n) => aim({ level: n === level ? undefined : n })} />
          <NumberField label="Armor" value={target.armor} min={0} max={10000000} onChange={(armor) => aim({ armor })} />
          {RESISTS.map((id) => (
            <NumberField
              key={id}
              label={`${elementName(id)} resistance`}
              value={target.resists[id] ?? 0}
              min={-300}
              max={75}
              suffix="%"
              onChange={(n) => aim({ resists: { ...target.resists, [id]: n } })}
            />
          ))}
        </Popover>
      </div>

      {choices.length === 0 && <p className="note">Skills on the hotbar that deal damage can be picked here too.</p>}

      <dl className="totals-main damage-main">
        <div>
          <dt className="cap">Damage a second</dt>
          <dd>{show(dps)}</dd>
        </div>
        <div>
          <dt className="cap">{casts ? 'Each cast' : 'Each attack'}</dt>
          <dd>{show(damage.total)}</dd>
        </div>
        <div>
          <dt className="cap">{casts ? 'Casts a second' : 'Attacks a second'}</dt>
          <dd>{+damage.rate.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="cap">Critical hit chance</dt>
          <dd>{+crit.toFixed(1)}%</dd>
        </div>
      </dl>

      {variants.length === 1 && under.name && <p className="note">Worked out as used with {under.name}, which the skill needs.</p>}
      {damage.pets !== undefined && <p className="note">Worked out with {+damage.pets.toFixed(2)} pets out, the most the skill keeps up.</p>}
      {retribution.spends && <p className="note">While any {retribution.name} stack is held, every cast is taken to spend one, and what that puts on the target to be there already.</p>}
      {aura?.damage && (
        <p className="note">
          {aura.name} is on and deals {show(aura.damage.dps)} of the damage a second on its own, whatever is used.
        </p>
      )}
      {!own.weapon && <p className="note skipped">No weapon is held, so basic attacks are unarmed and skills that build on weapon damage have little to build on.</p>}

      {chosen && (
        <section className="group">
          <div className="group-head">
            <h2>{casts ? 'Each cast' : 'Each attack'}</h2>
          </div>
          <ul className="totals one">
            {damage.parts.map(({ hit, count, damage: each }, i) => (
              <li key={i}>
                <span>
                  <span className="v">{+count.toFixed(2)} ×</span> {ELEMENTS[hit!.element].name} {WHEN[hit!.when]}
                </span>
                <span className="v">{show(sum(each))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {aura?.damage && (
        <section className="group">
          <div className="group-head">
            <h2>{aura.name}</h2>
          </div>
          <ul className="totals one">
            {aura.damage.parts.map(({ hit, count, damage: each }, i) => (
              <li key={i}>
                <span>
                  <span className="v">{+count.toFixed(2)} ×</span> {ELEMENTS[hit!.element].name} {WHEN[hit!.when]}
                </span>
                <span className="v">{show(sum(each))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {elements.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>By element</h2>
          </div>
          <ul className="totals one">
            {elements.map(([element, value]) => (
              <li key={element}>
                <span>{ELEMENTS[element].name}</span>
                <span>
                  <span className="v">{show(value)}</span> a second, {Math.round((value / dps) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {left.length > 0 && <p className="note">Left out, because they depend on the moment: {left.join(', ')}.</p>}
    </div>
  );
}

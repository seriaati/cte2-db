import { useMemo } from 'react';
import { rolled, type StatMod } from '../../lib/affix';
import { RESISTS, type Build } from '../../lib/buildRules';
import { ELEMENTS, UNARMED, attackDamage, attackRate, skillDamage, type ByElement, type Element, type Fighter, type SkillHit } from '../../lib/damageRules';
import { bonusSkillLevels, type Exact } from '../../lib/statRules';
import { Dropdown } from '../controls';
import { Loading, NumberField, Popover, useSection, type TabProps } from './shared';
import { useTotals } from './totals';

const show = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en') : `${+n.toFixed(1)}`);
const sum = (damage: ByElement) => Object.values(damage).reduce((total, value) => total + value, 0);
const elementName = (id: string) => Object.values(ELEMENTS).find((element) => element.id === id)!.name;
const WHEN: Record<SkillHit['when'], string> = { cast: 'when cast', hit: 'when a projectile hits', tick: 'over time', end: 'as it ends' };

// What the skill picked on this tab deals, for the tab and for the summary beside the editor. Null
// until the game data it draws on has arrived.
export function useDamage(build: Build) {
  const rules = useSection('damage');
  const skills = useSection('skills');
  const own = useTotals(build);
  const { level } = build;
  const { target } = build.damage;

  // Skills on the hotbar that deal damage themselves.
  const perks = skills?.classes.filter((c) => build.classes.includes(c.id)).flatMap((c) => c.perks) ?? [];
  const choices = build.hotbar.flatMap((slot) => {
    const perk = perks.find((p) => p.id === slot?.spell);
    return slot && perk?.spell && build.perks[perk.id] > 0 && rules?.skills[perk.id] ? [{ slot, perk, spell: perk.spell }] : [];
  });
  const chosen = choices.find((c) => c.perk.id === build.damage.skill);
  const top = chosen ? chosen.spell.maxLevel + skills!.bonusLevels : 1;
  const rank = chosen && own ? build.perks[chosen.perk.id] + bonusSkillLevels(own.stats, chosen.spell.tagIds, skills!.bonusLevels) : 0;

  // StatCalculation.calc: a skill is used with its own stats and its support gems' on top of the character's.
  const extra = useMemo((): Exact[] => {
    if (!chosen) return [];
    const exact = (stats: StatMod[], roll: number) => stats.map((s): Exact => ({ id: s.id, type: s.type, value: rolled(s, roll, level) }));
    const supports = chosen.slot.supports.flatMap((gem) => exact(skills!.supports.find((s) => s.id === gem.id)?.stats ?? [], gem.roll ?? 100));
    return [...exact(chosen.spell.stats, Math.trunc(Math.fround(rank / top) * 100)), ...supports];
  }, [skills, rules, build.hotbar, build.classes, build.perks, build.damage.skill, rank, top, level]);
  const unit = useTotals(build, extra);

  if (!rules || !skills || !own || !unit) return null;

  const who: Fighter = { level, own: own.stats, unit: unit.stats, weapon: (own.weapon && rules.weapons[own.weapon]) || UNARMED, dualWield: own.dualWield };
  // The target has armor and resistances and nothing else.
  const defenses = [['armor', target.armor] as const, ...RESISTS.map((id) => [`${id}_resist`, target.resists[id] ?? 0] as const)];
  const enemy = { level: target.level ?? level, stats: new Map(defenses.map(([id, value]) => [id, { value, more: 1 }])), rules: {} };
  // The states a skill can be used in go by the effects they take.
  const variants = chosen ? rules.skills[chosen.perk.id].variants.map((variant) => ({ variant, name: variant.needs.join(' and ') })) : [];
  const under = variants.find((v) => v.name === build.damage.under) ?? variants[0];
  const damage = chosen ? skillDamage(rules, who, enemy, rules.skills[chosen.perk.id], under.variant, rank, top) : attackDamage(rules, who, enemy, build.damage.attacks ?? attackRate(who));
  // The stats the hit is made with.
  const stats = chosen ? who.unit : who.own;
  const crit = Math.min(100, Math.max(0, stats.get('critical_hit')?.value ?? 0));
  return { rules, own, choices, chosen, variants, under, enemy, damage, stats, crit };
}

export default function DamageTab({ core, build, change }: TabProps) {
  const found = useDamage(build);
  if (!found) return <Loading />;

  const { rules, own, choices, chosen, variants, under, enemy, damage, stats, crit } = found;
  const { level } = build;
  const { target } = build.damage;
  const elements = (Object.entries(damage.perUse) as [Element, number][]).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const left = rules.situational.filter((id) => stats.get(id)?.value || (stats.get(id)?.more ?? 1) !== 1).map((id) => own.rules.defs[id].name.replace('[VAL1]', 'X'));

  const set = (patch: Partial<Build['damage']>) => change({ damage: { ...build.damage, ...patch } });
  const aim = (patch: Partial<Build['damage']['target']>) => set({ target: { ...target, ...patch } });

  return (
    <div className="plain">
      <div className="title-row">
        <h1>Damage</h1>
      </div>
      <p className="note">
        What one skill deals a second to a single enemy when it is used over and over. Of projectiles shot together one is taken to hit, and what goes on over time lands every time. Critical
        hits and other chances count as their average.
      </p>

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
          <dd>{show(damage.dps)}</dd>
        </div>
        <div>
          <dt className="cap">{chosen ? 'Each cast' : 'Each attack'}</dt>
          <dd>{show(damage.total)}</dd>
        </div>
        <div>
          <dt className="cap">{chosen ? 'Casts a second' : 'Attacks a second'}</dt>
          <dd>{+damage.rate.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="cap">Critical hit chance</dt>
          <dd>{+crit.toFixed(1)}%</dd>
        </div>
      </dl>

      {variants.length === 1 && under.name && <p className="note">Worked out as used with {under.name}, which the skill needs.</p>}
      {!own.weapon && <p className="note skipped">No weapon is held, so basic attacks are unarmed and skills that build on weapon damage have little to build on.</p>}

      {chosen && (
        <section className="group">
          <div className="group-head">
            <h2>Each cast</h2>
          </div>
          <ul className="totals one">
            {damage.parts.map(({ hit, count, damage: each }, i) => (
              <li key={i}>
                <span>
                  <span className="v">{count} ×</span> {ELEMENTS[hit!.element].name} {WHEN[hit!.when]}
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
                  <span className="v">{show(value * damage.rate)}</span> a second, {Math.round((value / damage.total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {left.length > 0 && <p className="note">Left out, because they depend on the moment: {left.join(', ')}.</p>}
      <p className="note">
        The target has no dodge or block, and neither side has buffs, curses or ailments on it. Ailments and the damage they deal over time, summons, and spells set off by other effects aren't
        worked out yet.
      </p>
    </div>
  );
}

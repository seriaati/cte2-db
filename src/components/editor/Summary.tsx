import type { ReactNode } from 'react';
import { percent, resistText, show } from '../../lib/buildCalc';
import type { Build } from '../../lib/buildRules';
import type { Core } from '../../lib/builds';
import { ELEMENTS } from '../../lib/damageRules';
import { useDamage } from './DamageTab';
import { useDefense } from './DefenseTab';
import { Loading } from './shared';

const RESOURCES = ['health', 'magic_shield', 'mana', 'energy', 'blood'] as const;

// `key` is a number the build is judged by, `sub` a detail of the row above it.
function Row({ label, value, kind }: { label: string; value: ReactNode; kind?: 'key' | 'sub' }) {
  return (
    <li className={kind}>
      <span>{label}</span>
      <span className="v">{value}</span>
    </li>
  );
}

// The build at a glance: what its skill deals, how it holds up, and the stats both rest on. The
// Damage and Defense tabs have the detail and the settings these numbers are worked out with.
export default function Summary({ core, build }: { core: Core; build: Build }) {
  const attack = useDamage(build);
  const defense = useDefense(build, attack);
  if (!attack || !defense) return <Loading />;

  const { own, chosen, form, damage, aura, lasting, procs, dps, stats, crit, retribution, resources } = attack;
  const named = (enemy: boolean) => own.effects.filter((effect) => effect.enemy === enemy && effect.stacks).map((effect) => (effect.stacks > 1 ? `${effect.stacks} ${effect.name}` : effect.name));
  const casts = chosen && damage.pets === undefined;
  const { totals, value, avoid, rows, weakest, shortest, held } = defense;
  const { defs } = totals.rules;

  return (
    <div className="summary">
      {totals.skipped.map((reason) => (
        <p key={reason} className="note skipped">
          {reason}
        </p>
      ))}

      <section className="group">
        <div className="group-head">
          <h2>Damage</h2>
        </div>
        <ul className="totals one">
          <Row label="Skill" value={chosen?.spell.name ?? 'Basic attack'} />
          {form && form.needs.length > 0 && <Row kind="sub" label="Used with" value={form.needs.join(' and ')} />}
          {retribution.spends && retribution.stacks > 0 && <Row kind="sub" label="Spends" value={retribution.name} />}
          {aura && <Row kind="sub" label="Aura" value={aura.name} />}
          {named(false).length > 0 && <Row kind="sub" label="Effects" value={named(false).join(', ')} />}
          {named(true).length > 0 && <Row kind="sub" label="On the enemy" value={named(true).join(', ')} />}
          <Row kind="key" label="Damage a second" value={show(dps)} />
          {resources.dry && <Row kind="sub" label={`Once out of ${totals.rules.defs[resources.dry.resource].name.toLowerCase()}`} value={show(resources.kept)} />}
          {aura?.damage && <Row kind="sub" label={`From ${aura.name}`} value={show(aura.damage.dps)} />}
          {lasting.map((effect) => (
            <Row key={effect.name} kind="sub" label={`From ${effect.name}`} value={show(effect.damage.dps)} />
          ))}
          {procs.map((proc) => (
            <Row key={proc.name} kind="sub" label={`From ${proc.name}`} value={show(proc.damage.dps)} />
          ))}
          <Row label={casts ? 'Each cast' : 'Each attack'} value={show(damage.total)} />
          <Row label={casts ? 'Casts a second' : 'Attacks a second'} value={+damage.rate.toFixed(2)} />
          {damage.pets !== undefined && <Row label="Pets out" value={+damage.pets.toFixed(2)} />}
          <Row label={defs.critical_hit.name} value={`${+crit.toFixed(1)}%`} />
          <Row label={defs.critical_damage.name} value={`${show(stats.get('critical_damage')?.value ?? defs.critical_damage.base)}%`} />
          {damage.lands < 1 && <Row label="Chance to hit" value={percent(damage.lands)} />}
        </ul>
      </section>

      <section className="group">
        <div className="group-head">
          <h2>Attributes</h2>
        </div>
        <ul className="totals one">
          {core.attributes.map((stat) => (
            <Row key={stat.id} label={stat.name} value={show(Math.trunc(value(stat.id)))} />
          ))}
        </ul>
      </section>

      <section className="group">
        <div className="group-head">
          <h2>Defense</h2>
        </div>
        <ul className="totals one">
          <Row kind="key" label="Effective health" value={show(weakest.effectiveHealth)} />
          <Row kind="sub" label="Lasts from full" value={Number.isFinite(shortest.lasts) ? `${show(shortest.lasts)} s` : 'Out-heals its hits'} />
          {RESOURCES.filter((id) => id !== 'blood' || value(id) > 0).flatMap((id) => [
            <Row key={id} label={defs[id].name} value={show(value(id))} />,
            held[id] > 0 && <Row key={`${id} back`} kind="sub" label="Recovered" value={`${show(held[id])}/s`} />,
            id === 'health' && defense.aura && defense.aura.cost > 0 && <Row key="aura" kind="sub" label={`Lost to ${defense.aura.name}`} value={`${show(defense.aura.cost)}/s`} />,
          ])}
          <Row label="Armor" value={`${percent(rows[0].resisted.used / 100)} (${show(value('armor'))})`} />
          <Row label="Attacks dodged" value={`${percent(avoid.dodge)} (${show(value('dodge'))})`} />
          {totals.shield && <Row label="Hits blocked" value={percent(avoid.blocked)} />}
          {rows.slice(1).map(({ element, resisted }) => (
            <Row key={element} label={`${ELEMENTS[element].name} resistance`} value={resistText(resisted)} />
          ))}
        </ul>
      </section>

      <p className="note">The skill is picked on the Damage tab, and the enemy both are measured against on the Damage or the Defense tab.</p>
    </div>
  );
}

import type { ReactNode } from 'react';
import { percent, resistText, show } from '../../lib/buildCalc';
import type { Build } from '../../lib/buildRules';
import type { Core } from '../../lib/builds';
import { ELEMENTS } from '../../lib/damageRules';
import { useDamage } from './DamageTab';
import { useDefense } from './DefenseTab';
import { Loading } from './shared';

const RESOURCES = ['health', 'magic_shield', 'mana', 'energy'];

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
  const defense = useDefense(build);
  if (!attack || !defense) return <Loading />;

  const { chosen, under, damage, aura, dps, stats, crit, retribution } = attack;
  const casts = chosen && damage.pets === undefined;
  const { totals, value, avoid, rows, weakest } = defense;
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
          {under?.name && <Row kind="sub" label="Used with" value={under.name} />}
          {retribution.spends && retribution.stacks > 0 && <Row kind="sub" label="Spends" value={retribution.name} />}
          {aura && <Row kind="sub" label="Aura" value={aura.name} />}
          <Row kind="key" label="Damage a second" value={show(dps)} />
          {aura?.damage && <Row kind="sub" label={`From ${aura.name}`} value={show(aura.damage.dps)} />}
          <Row label={casts ? 'Each cast' : 'Each attack'} value={show(damage.total)} />
          <Row label={casts ? 'Casts a second' : 'Attacks a second'} value={+damage.rate.toFixed(2)} />
          {damage.pets !== undefined && <Row label="Pets out" value={+damage.pets.toFixed(2)} />}
          <Row label={defs.critical_hit.name} value={`${+crit.toFixed(1)}%`} />
          <Row label={defs.critical_damage.name} value={`${show(stats.get('critical_damage')?.value ?? defs.critical_damage.base)}%`} />
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
          {RESOURCES.flatMap((id) => [
            <Row key={id} label={defs[id].name} value={show(value(id))} />,
            // OnServerTick: a resource's regen stat comes in once a second.
            value(`${id}_regen`) > 0 && <Row key={`${id} regen`} kind="sub" label="Regeneration" value={`${show(value(`${id}_regen`))}/s`} />,
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

      <p className="note">The skill and its target are picked on the Damage tab, and the enemy that defenses are measured against on the Defense tab.</p>
    </div>
  );
}

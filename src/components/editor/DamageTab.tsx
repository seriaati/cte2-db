import { useMemo } from 'react';
import { buildDamage, percent } from '../../lib/buildCalc';
import { RESISTS, type Build } from '../../lib/buildRules';
import { ELEMENTS, resistance, volleysMissed, type ByElement, type Resource, type SkillHit } from '../../lib/damageRules';
import { Dropdown } from '../controls';
import { AuraField, EffectsField, EnemyField, Info, Loading, RetributionField, useSection, type TabProps } from './shared';
import { useData } from './totals';

const show = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en') : `${+n.toFixed(1)}`);
const sum = (damage: ByElement) => Object.values(damage).reduce((total, value) => total + value, 0);
const WHEN: Record<SkillHit['when'], string> = {
  cast: 'when cast',
  hit: 'when a projectile hits',
  tick: 'over time',
  end: 'as it ends',
  attack: 'when a pet attacks',
  spell: 'when a pet casts its spell',
  aura: 'a second',
  struck: 'a second, as basic attacks land',
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

  const { rules, own, choices, chosen, form, forced, enemy, damage, aura, lasting, procs, dps, elements, stats, crit, retribution, resources } = found;
  // A summon skill is used by its pets, one attack at a time.
  const casts = chosen && damage.pets === undefined;
  const { defs } = own.rules;
  const left = rules.situational.filter((id) => stats.get(id)?.value || (stats.get(id)?.more ?? 1) !== 1).map((id) => defs[id].name.replace('[VAL1]', 'X'));
  const missed = volleysMissed(damage.parts);
  const { cost, petCost, spent, recovered, dry, kept } = resources;
  const used = (Object.keys(spent) as Resource[]).filter((id) => spent[id]! > 0);

  const set = (patch: Partial<Build['damage']>) => change({ damage: { ...build.damage, ...patch } });

  return (
    <div className="plain">
      <div className="title-row">
        <h1>Damage</h1>
        <Info>
          <p>
            What one skill deals a second to a single enemy when it is used over and over. What goes on over time lands every time. A summon skill deals what its pets do: as many as
            it can keep out, all attacking that enemy without pause. Critical hits and other chances count as their average.
          </p>
          <p>
            Using the skill costs mana and energy, or blood for a blood user: what it costs at its level as the build's stats change that, every cast, or every pulse of a
            channelled skill. A summon skill is cast as often as it takes to keep its pets out, and a golem's attacks cost its owner mana too. A basic attack costs energy with a
            trident, and always when unarmed. What comes back while fighting is regeneration, which the pack doesn't slow in combat, and what every hit counted here leeches or
            restores on a hit, no more a second than the leech cap. Where that is less than the skill costs, the damage a second is still what it deals at full pace, and a note
            says how long a full pool lasts and what can be kept up after, with the skill used only as often as what comes back pays for. Restores on a kill don't count, for the
            enemy never dies.
          </p>
          <p>
            Of projectiles shot together, the ones that hit are those that pass close enough to an enemy as big as a zombie 5 blocks away, aimed so that the most do. Fanned out or
            shot in a circle, as Projectile Nova does, they hit by their angle; with Projectile Barrage they fly side by side a block apart, so two can hit. A homing one hits if it
            passes within its tracking range, two blocks. Every projectile a Retribution stack buys hits. Chains and piercing add no hits on one enemy: a projectile hits a mob
            once, and a chain never goes back to the one it came from. Projectile speed and random spread change nothing.
          </p>
          <p>
            Effects lists what the build can put on the character and on the enemy: what its skills give, and what its stats give on a hit, on a kill, when the character is hit or
            every ten seconds, such as charges. One that is on is taken to be kept up the whole time, at the stacks set, however small the chance of gaining it. It is as strong as the
            level of the skill that gives it makes it, and where only a stat gives it, as it is at the lowest level. A skill that changes with the effects on its caster is used in the
            form they call for. The same goes for the aura set to be on.
          </p>
          <p>
            Some effects deal damage themselves while they last, such as Cloak of Hidden Blades from Whirling Blades, Damnation, or the Steam that Steam Cloud builds up. Every tick is a
            hit of the skill that gave the effect, at the level the character has it and with its support gems: it can be a critical hit, can be dodged and can set off spells. When
            the skill picked leaves such an effect, what it deals is part of each cast: the ticks of its whole life, or only those between two casts where the next cast renews it
            first, so that casting faster adds nothing. An effect renewed by every cast is taken at all the stacks it can hold. One that deals damage only as it ends, like Petrify,
            deals none while casts keep renewing it. Stats that make effects last longer count.
          </p>
          <p>
            One set to be on under Effects is kept up whatever is used, and what it deals is listed under its own name. Thorn, Enflamed and Encased deal theirs when a basic attack
            hits the enemy holding them, so only with Basic attack picked. They are taken to be there for every attack, though in the game each attack uses one up. What Encased
            stuns is left out.
          </p>
          <p>
            The enemy is a mob with the armor, dodge and resistances the game gives one of its level, rarity and affixes. It is set under Enemy, and is the one the Defense tab is worked
            out against. What a kind of mob, a dimension or a map adds is left out, and so is its health. It never blocks.
          </p>
          <p>
            It dodges spells tagged magic with its magic dodge and every other hit with its dodge rating, after the Accuracy the skill is used with comes off. A dodged hit deals nothing
            and causes no ailment, what a hit adds in other elements lands or misses with it, and dodges count as their average: a hit that lands three times in four shows as 0.75
            hits. Pets hit with the character's Accuracy, at the character's level. Accuracy does nothing else: whatever its description says, critical hits don't fail for the lack of
            it.
          </p>
          <p>
            A stat that casts a spell on a hit counts. Every hit that meets what the stat asks for rolls its chance: the skill's hits, a pet's, the aura's and those of other set-off
            spells. Most stats ask for a hit that lands, and a few roll on a dodged hit too, as they do in the game. An ailment that a hit causes rolls for the stats that ask for one.
            What the spell deals is part of the damage a second and is listed under Set off by hits.
          </p>
          <p>
            A set-off spell can't go off again until its cooldown is over. One that hits would set off 4 times a second, with a cooldown of half a second, goes off 4 / (1 + 4 × 0.5)
            times: 1.33 a second. It is cast once, costs no mana or energy, and its own hits don't set it off again. A class skill is cast at the level the character has it, the lowest
            it goes when it isn't learned, with the support gems of its hotbar slot. A spell no class teaches, like Discharge, goes by the level and the support gems of the skill it
            belongs to.
          </p>
          <p>
            Spells set off by a kill, by a death or by a hit the character takes are left out, and named at the bottom of the tab when the build has one. Set-off spells that deal the
            enemy nothing, such as heals, buffs and a summoned spider, are left out too. One that leaves an effect which deals damage, like Steam Cloud, has that counted with it, with
            its casts taken to come evenly. Ailments and the damage they deal over time aren't worked out yet.
          </p>
        </Info>
      </div>

      <div className="controls">
        <Dropdown
          label="Skill"
          value={chosen?.perk.id ?? ''}
          groups={[{ options: [{ value: '', label: 'Basic attack' }, ...choices.map((c) => ({ value: c.perk.id, label: c.spell.name, icon: c.perk.icon }))] }]}
          onChange={(skill) => set({ skill })}
        />
        {retribution.spends && <RetributionField build={build} change={change} />}
        <AuraField build={build} change={change} />
        <EffectsField effects={own.effects} build={build} change={change} />
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
        <EnemyField core={core} build={build} change={change} enemy={own.enemy} />
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
        {damage.lands < 1 && (
          <div>
            <dt className="cap">Chance to hit</dt>
            <dd>{percent(damage.lands)}</dd>
          </div>
        )}
      </dl>

      {dry && (
        <p className="note">
          At this pace {defs[dry.resource].name.toLowerCase()} runs out after {show(dry.after)} s; after that {show(kept)} damage a second can be kept up.
          {dry.resource === 'energy' && own.shield && ' Below 1 energy, a raised shield blocks nothing.'}
        </p>
      )}
      {form && form.needs.length > 0 && <p className="note">{forced ? `Worked out as used with ${form.needs.join(' and ')}, which the skill needs.` : `Used in the form it takes with ${form.needs.join(' and ')}.`}</p>}
      {damage.pets !== undefined && <p className="note">Worked out with {+damage.pets.toFixed(2)} pets out, the most the skill keeps up.</p>}
      {missed.length > 0 && (
        <p className="note">
          Of projectiles shot together, {missed.map(({ shot, hit }) => `${hit} of ${shot}`).join(' and ')} {missed.length === 1 && missed[0].hit === 1 ? 'is' : 'are'} taken to hit the enemy.
        </p>
      )}
      {retribution.spends && <p className="note">While any {retribution.name} stack is held, every cast spends {retribution.spent > 1 ? retribution.spent : 'one'}, taken to be held again by the next, and what that puts on the target is taken to be there already.</p>}
      {aura?.damage && (
        <p className="note">
          {aura.name} is on and deals {show(aura.damage.dps)} of the damage a second on its own, whatever is used.
        </p>
      )}
      {lasting.length > 0 && (
        <p className="note">
          Effects that are on deal {show(lasting.reduce((all, effect) => all + effect.damage.dps, 0))} of the damage a second on their own: {lasting.map((effect) => effect.name).join(', ')}.
        </p>
      )}
      {procs.length > 0 && <p className="note">Spells set off by hits deal {show(procs.reduce((all, proc) => all + proc.damage.dps, 0))} of the damage a second.</p>}
      {!own.weapon && <p className="note skipped">No weapon is held, so basic attacks are unarmed and skills that build on weapon damage have little to build on.</p>}

      {chosen && damage.parts.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>{casts ? 'Each cast' : 'Each attack'}</h2>
          </div>
          <ul className="totals one">
            {damage.parts.map(({ hit, count, damage: each }, i) => (
              <li key={i}>
                <span>
                  <span className="v">{+count.toFixed(2)} ×</span> {ELEMENTS[hit!.element].name} {WHEN[hit!.when]}
                  {hit!.effect && `, from ${hit!.effect}`}
                </span>
                <span className="v">{show(sum(each))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {used.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>Costs and recovery</h2>
          </div>
          <ul className="totals one">
            {used.flatMap((id) => [
              <li key={`${id} use`}>
                <span>
                  {defs[id].name} {chosen ? 'each cast' : 'each attack'}
                </span>
                <span className="v">{show(cost[id] ?? 0)}</span>
              </li>,
              petCost?.[id] ? (
                <li key={`${id} pet`}>
                  <span>{defs[id].name} each pet attack</span>
                  <span className="v">{show(petCost[id])}</span>
                </li>
              ) : null,
              <li key={`${id} spent`}>
                <span>{defs[id].name} spent a second</span>
                <span className="v">{show(spent[id]!)}</span>
              </li>,
              <li key={`${id} back`}>
                <span>{defs[id].name} recovered a second</span>
                <span className="v">{show(recovered[id])}</span>
              </li>,
            ])}
          </ul>
        </section>
      )}

      {[...(aura?.damage ? [{ name: aura.name, damage: aura.damage }] : []), ...lasting].map(({ name, damage: dealt }) => (
        <section key={name} className="group">
          <div className="group-head">
            <h2>{name}</h2>
          </div>
          <ul className="totals one">
            {dealt.parts.map(({ hit, count, damage: each }, i) => (
              <li key={i}>
                <span>
                  <span className="v">{+count.toFixed(2)} ×</span> {ELEMENTS[hit!.element].name} {WHEN[hit!.when]}
                </span>
                <span className="v">{show(sum(each))}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {procs.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>Set off by hits</h2>
          </div>
          <ul className="totals one">
            {procs.map(({ name, damage: each }) => (
              <li key={name}>
                <span>
                  <span className="v">{+each.rate.toFixed(2)} ×</span> {name} a second
                </span>
                <span className="v">{show(each.total)}</span>
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

      <section className="group">
        <div className="group-head">
          <h2>Enemy</h2>
        </div>
        <ul className="totals one">
          {['armor', 'dodge', 'spell_dodge'].map((id) => (
            <li key={id}>
              <span>{defs[id].name}</span>
              <span className="v">{show(enemy.stats.get(id)?.value ?? 0)}</span>
            </li>
          ))}
          {RESISTS.map((id) => (
            <li key={id}>
              <span>{defs[`${id}_resist`].name}</span>
              <span className="v">{resistance(enemy.stats, id, 0)}%</span>
            </li>
          ))}
        </ul>
      </section>

      {left.length > 0 && <p className="note">Left out, because they depend on the moment: {left.join(', ')}.</p>}
    </div>
  );
}

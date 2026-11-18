import { buildDefense, percent, resistText, show } from '../../lib/buildCalc';
import type { Build } from '../../lib/buildRules';
import { ELEMENTS, type ByResource, type Resource } from '../../lib/damageRules';
import { useDamage } from './DamageTab';
import { AuraField, EffectsField, EnemyField, Info, Loading, NumberField, Popover, RetributionField, useSection, type TabProps } from './shared';

// How the build holds up against the enemy set for it while it uses what `attack` worked out, for
// the tab and for the summary beside the editor. Null until the game data it draws on has arrived.
export function useDefense(build: Build, attack: ReturnType<typeof useDamage>) {
  const defense = useSection('defense');
  const damage = useSection('damage');
  return defense && damage && attack ? buildDefense({ damage, defense }, build, attack) : null;
}

// Which of the hotbar's skills that heal and deal no damage are cast whenever they are ready.
function DefensiveField({ offered, build, change }: Pick<TabProps, 'build' | 'change'> & { offered: { id: string; name: string }[] }) {
  if (!offered.length) return null;
  const on = offered.filter((skill) => build.defensive.includes(skill.id)).length;
  const flip = (id: string) => change({ defensive: build.defensive.includes(id) ? build.defensive.filter((other) => other !== id) : [...build.defensive, id] });
  return (
    <Popover wide label={on ? `Defensive skills (${on})` : 'Defensive skills'}>
      <div className="effects">
        <span className="cap">Cast whenever ready</span>
        <div className="effect-list">
          {offered.map((skill) => (
            <button key={skill.id} className="btn" type="button" aria-pressed={build.defensive.includes(skill.id)} onClick={() => flip(skill.id)}>
              {skill.name}
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

export default function DefenseTab({ core, build, change }: TabProps) {
  const attack = useDamage(build);
  const found = useDefense(build, attack);
  if (!found) return <Loading />;

  const { rules, totals, value, enemy, avoid, rows, weakest, shortest, held, aura } = found;
  const { shield } = totals;
  const set = (patch: Partial<Build['defense']>) => change({ defense: { ...build.defense, ...patch } });
  const { defensive } = attack!;
  const healed = (by: ByResource, times: number) =>
    (Object.entries(by) as [Resource, number][])
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${show(n * times)} ${totals.rules.defs[id].name.toLowerCase()}`)
      .join(' and ') || 'Nothing';
  const left = rules.situational.filter((id) => value(id)).map((id) => totals.rules.defs[id].name.replace('[VAL1]', 'X'));

  return (
    <div className="plain">
      <div className="title-row">
        <h1>Defense</h1>
        <Info>
          <p>
            How the build holds up against a mob's hits. Effective health is the damage those hits add up to by the time a character at full health falls, counted before the character's
            defenses and before what the mob's rarity and affixes add. Dodges, blocks and other chances count as their average, and nothing is healed in between.
          </p>
          <p>
            The enemy is the mob the Damage tab's skill is used on, set under Enemy on either tab. Every mob has some accuracy and armor penetration and deals half again as much elemental
            and chaos damage, so a hit can come to more than its size. Its rarity multiplies its hits, and an affix that adds an element adds it to physical hits. Its hits are attacks.
            Neither side has buffs, curses or ailments on it but the Retribution stacks a Crusader is set to hold, what the aura set to be on gives, and the effects set to be on under
            Effects, out of those the build's skills and stats give, each taken to be kept up the whole time. What an aura costs its caster is left out of effective health, as are regeneration, leech and healing.
          </p>
          <p>
            Recovery is what comes back a second while fighting: regeneration, which the pack doesn't slow in combat, and what the hits of the skill picked on the Damage tab leech
            or restore on a hit, at the pace it can keep up and no more a second than the leech cap. Set against it are the enemy's hits a second at the pace set, after
            defenses, dodges and blocks, and what the aura costs. So do what the skill picked on the Damage tab heals its user with each use and what the skills set under Defensive
            skills heal. Restores on a kill don't count, for the enemy never dies, and neither do potions and food. Stats that restore
            on block or on dodge do nothing here: in the game they go to the one whose hit is blocked or dodged, and a mob blocks nothing and gives nothing back.
          </p>
          <p>
            Defensive skills lists the skills on the hotbar that heal and deal no damage. One that is on is cast whenever it is ready, at the level the character has it and with its
            support gems, and heals as its stats and the character's make it: on the character, on allies around it or around a totem it puts down, and over time through an effect
            it gives, which the next cast renews. What it costs is spent, and the time its cast and the recovery after it take comes off the Damage tab's skill or basic attack
            where they leave it too little, which lowers the damage a second. Heals from a projectile land wherever it goes and are left out, as is what auras heal.
          </p>
        </Info>
      </div>

      <div className="controls">
        <EnemyField core={core} build={build} change={change} enemy={totals.enemy}>
          <NumberField label="Hit of a common mob" value={enemy.hit} min={1} max={100000000} onChange={(hit) => set({ hit })} />
          <NumberField label="Hits a second" value={enemy.rate} min={1} max={20} onChange={(rate) => set({ rate })} />
        </EnemyField>
        <RetributionField build={build} change={change} />
        <AuraField build={build} change={change} />
        <EffectsField effects={totals.effects} build={build} change={change} />
        <DefensiveField offered={defensive.offered} build={build} change={change} />
      </div>

      <dl className="totals-main">
        <div>
          <dt className="cap">Effective health</dt>
          <dd>{show(weakest.effectiveHealth)}</dd>
        </div>
        <div>
          <dt className="cap">Health</dt>
          <dd>{show(value('health'))}</dd>
        </div>
        <div>
          <dt className="cap">Magic shield</dt>
          <dd>{show(value('magic_shield'))}</dd>
        </div>
        <div>
          <dt className="cap">Armor</dt>
          <dd>{show(value('armor'))}</dd>
        </div>
        <div>
          <dt className="cap">Attacks dodged</dt>
          <dd>{percent(avoid.dodge)}</dd>
        </div>
        <div>
          <dt className="cap">Hits blocked</dt>
          <dd>{percent(avoid.blocked)}</dd>
        </div>
      </dl>

      <p className="note">The effective health above is the lowest of the five below, against {ELEMENTS[weakest.element].name.toLowerCase()} hits.</p>

      <section className="group">
        <div className="group-head">
          <h2>By element</h2>
        </div>
        <table className="by-element">
          <thead>
            <tr>
              <th className="cap">Hit</th>
              <th className="cap">Resisted</th>
              <th className="cap">Taken of {show(enemy.hit)}</th>
              <th className="cap">Effective health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ element, resisted, lands, effectiveHealth }) => (
              <tr key={element}>
                <th scope="row">{ELEMENTS[element].name}</th>
                <td>{element === 'Physical' ? `${percent(resisted.used / 100)} by armor` : resistText(resisted)}</td>
                <td>
                  <span className="v">{show(lands)}</span>, {percent(lands / enemy.hit)}
                </td>
                <td className="v">{show(effectiveHealth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="group">
        <div className="group-head">
          <h2>Dodge and block</h2>
        </div>
        <ul className="totals one">
          <li>
            <span>Attacks dodged</span>
            <span className="v">{percent(avoid.dodge)}</span>
          </li>
          <li>
            <span>Magic spells dodged</span>
            <span className="v">{percent(avoid.spellDodge)}</span>
          </li>
          {shield && (
            <>
              <li>
                <span>Chance to block when a block is ready</span>
                <span className="v">{percent(avoid.block)}</span>
              </li>
              <li>
                <span>Share of a blocked hit that is stopped</span>
                <span className="v">{percent(avoid.stops)}</span>
              </li>
              <li>
                <span>Time until the next block is ready</span>
                <span>
                  <span className="v">{avoid.recovery}</span> s
                </span>
              </li>
              <li>
                <span>Hits blocked at {enemy.rate} a second</span>
                <span className="v">{percent(avoid.blocked)}</span>
              </li>
            </>
          )}
          <li>
            <span>Damage that dodging and blocking stop</span>
            <span className="v">{percent(1 - (1 - avoid.dodge) * (1 - avoid.blocked * avoid.stops))}</span>
          </li>
        </ul>
        {!shield && value('block_chance') > 0 && <p className="note skipped">Blocking needs a shield in the off hand, so the build's block chance does nothing.</p>}
      </section>

      {aura && aura.cost > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>{aura.name}</h2>
          </div>
          <ul className="totals one">
            <li>
              <span>Damage it deals its caster a second, after defenses</span>
              <span className="v">{show(aura.cost)}</span>
            </li>
            <li>
              <span>Share of health and magic shield</span>
              <span className="v">{percent(aura.cost / (value('health') + value('magic_shield')))}</span>
            </li>
          </ul>
        </section>
      )}

      {defensive.used.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>Defensive skills</h2>
          </div>
          <ul className="totals one">
            {defensive.used.map((skill) => (
              <li key={skill.id}>
                <span>
                  {skill.name}, every {show(1 / skill.rate)} s
                </span>
                <span>{healed(skill.perUse, skill.rate)} a second</span>
              </li>
            ))}
          </ul>
          {defensive.pace < 1 && <p className="note">Casting them leaves the Damage tab's {attack!.chosen ? attack!.chosen.spell.name : 'basic attack'} {percent(defensive.pace)} of its full pace.</p>}
        </section>
      )}

      <section className="group">
        <div className="group-head">
          <h2>Recovery while fighting</h2>
        </div>
        <ul className="totals one">
          <li>
            <span>Health a second</span>
            <span className="v">{show(held.health)}</span>
          </li>
          {(value('magic_shield') > 0 || held.magic_shield > 0) && (
            <li>
              <span>Magic shield a second</span>
              <span className="v">{show(held.magic_shield)}</span>
            </li>
          )}
          <li>
            <span>Taken a second from {ELEMENTS[shortest.element].name.toLowerCase()} hits</span>
            <span className="v">{show(shortest.perSecond)}</span>
          </li>
        </ul>
        <p className="note">
          {Number.isFinite(shortest.lasts)
            ? `Against ${ELEMENTS[shortest.element].name.toLowerCase()} hits it falls after ${show(shortest.lasts)} s from full, with that coming back${aura && aura.cost > 0 ? ` and ${aura.name} taking its share` : ''}.`
            : "It recovers at least as fast as the enemy's hits take, so it never falls."}
        </p>
      </section>

      {(value('magic_shield') > 0 || value('mana_shield') > 0) && (
        <section className="group">
          <div className="group-head">
            <h2>Magic shield and mana</h2>
          </div>
          <ul className="totals one">
            {value('magic_shield') > 0 && (
              <li>
                <span>Chaos damage that goes past magic shield</span>
                <span className="v">{value('chaos_doesnt_bypass_magic_shield') > 0 ? 'None' : 'Half'}</span>
              </li>
            )}
            {value('mana_shield') > 0 && (
              <li>
                <span>Share of every hit that mana takes, until half the mana is gone</span>
                <span className="v">{percent(Math.min(1, value('mana_shield') / 100))}</span>
              </li>
            )}
          </ul>
        </section>
      )}

      {left.length > 0 && <p className="note">Left out, because they depend on the moment: {left.join(', ')}.</p>}
    </div>
  );
}

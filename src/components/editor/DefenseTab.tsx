import { buildDefense, percent, resistText, show } from '../../lib/buildCalc';
import type { Build } from '../../lib/buildRules';
import { ELEMENTS } from '../../lib/damageRules';
import { Dropdown } from '../controls';
import { AuraField, Info, Loading, NumberField, Popover, RetributionField, useSection, type TabProps } from './shared';
import { useTotals } from './totals';

// How the build holds up against the enemy set on this tab, for the tab and for the summary beside
// the editor. Null until the game data it draws on has arrived.
export function useDefense(build: Build) {
  const defense = useSection('defense');
  const damage = useSection('damage');
  const totals = useTotals(build);
  return defense && damage && totals ? buildDefense({ damage, defense }, build, totals) : null;
}

export default function DefenseTab({ core, build, change }: TabProps) {
  const found = useDefense(build);
  if (!found) return <Loading />;

  const { rules, totals, value, rarity, slots, enemy, avoid, rows, weakest, aura } = found;
  const { shield } = totals;
  const set = (patch: Partial<Build['defense']>) => change({ defense: { ...build.defense, ...patch } });
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
            Every mob has some accuracy and armor penetration and deals half again as much elemental and chaos damage, so a hit can come to more than its size. Its rarity multiplies its
            hits, and an affix that adds an element adds it to physical hits. Its hits are attacks. Neither side has buffs, curses or ailments on it but the Retribution stacks a Crusader is
            set to hold and what the aura set to be on gives. What an aura costs its caster is left out of effective health, as are regeneration, leech and healing.
          </p>
        </Info>
      </div>

      <div className="controls">
        <Popover label="Enemy">
          <NumberField label="Level" value={enemy.level} min={1} max={core.maxLevel} onChange={(n) => set({ level: n === build.level ? undefined : n })} />
          <Dropdown label="Rarity" value={rarity.id} groups={[{ options: rules.mob.rarities.map((r) => ({ value: r.id, label: r.name })) }]} onChange={(id) => set({ rarity: id })} />
          {slots.map((id, i) => (
            <Dropdown
              key={i}
              label={slots.length > 1 ? `Affix ${i + 1}` : 'Affix'}
              value={id}
              groups={[{ options: [{ value: '', label: 'None' }, ...rules.mob.affixes.map((a) => ({ value: a.id, label: a.name }))] }]}
              onChange={(picked) => set({ affixes: slots.map((old, at) => (at === i ? picked : old)) })}
            />
          ))}
          <NumberField label="Hit of a common mob" value={enemy.hit} min={1} max={100000000} onChange={(hit) => set({ hit })} />
          <NumberField label="Hits a second" value={enemy.rate} min={1} max={20} onChange={(rate) => set({ rate })} />
        </Popover>
        <RetributionField build={build} change={change} />
        <AuraField build={build} change={change} />
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

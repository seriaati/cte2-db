import { useState } from 'react';
import { formatRange, rolled } from '../../lib/affix';
import { MAX_CLASSES, SOLO_CLASS, SUPPORT_SLOTS, exactly, maxRank, pointsAt, supportSlots, type Build, type Skill } from '../../lib/buildRules';
import type { Sections } from '../../lib/builds';
import { calcText, cost } from '../../lib/spellRules';
import { bonusSkillLevels } from '../../lib/statRules';
import { Dropdown } from '../controls';
import { StatLine, StatLines } from '../StatLine';
import { Loading, NumberField, Picker, Slot, useSection, type Choice, type TabProps } from './shared';
import { useTotals } from './totals';

type Class = Sections['skills']['classes'][number];
type Perk = Class['perks'][number];

// A passive has no name of its own in the game, so it goes by what a level of it gives.
const perkName = (perk: Perk, level: number) =>
  perk.spell?.name ?? perk.stats.map((s) => formatRange(s, rolled(s, 100, level), rolled(s, 100, level))).map((l) => `${l.value} ${l.label}`.trim())[0];

export default function SkillsTab({ core, build, change, rolls, reset }: TabProps) {
  const data = useSection('skills');
  const totals = useTotals(build);
  const [selected, setSelected] = useState('');
  const [hovered, setHovered] = useState('');
  const [slot, setSlot] = useState(0);
  const [picking, setPicking] = useState<{ slot: number; support?: number } | null>(null);
  if (!data) return <Loading />;

  const { level } = build;
  const classes = build.classes.flatMap((id) => data.classes.find((c) => c.id === id) ?? []);
  const perks = new Map(classes.flatMap((c) => c.perks.map((perk) => [perk.id, perk] as const)));
  const rank = (id: string) => (perks.has(id) ? (build.perks[id] ?? 0) : 0);
  // The levels the rest of the build adds to a learned spell; none until its stats are worked out.
  const bonus = (perk: Perk) => (totals && perk.spell && rank(perk.id) ? bonusSkillLevels(totals.stats, perk.spell.tagIds, data.bonusLevels) : 0);
  const spentOn = (spells: boolean) => [...perks.values()].filter((p) => !!p.spell === spells).reduce((sum, p) => sum + rank(p.id), 0);
  const pools = (['spells', 'passives'] as const).map((id) => ({
    id,
    label: id === 'spells' ? 'Spell points' : 'Passive points',
    spent: spentOn(id === 'spells'),
    total: pointsAt(core.points[id], level, build.bonus[id]),
  }));
  const left = (perk: Perk) => pools[perk.spell ? 0 : 1].total - pools[perk.spell ? 0 : 1].spent;

  // Skills that are no longer learned leave the hotbar, and support gems leave slots that closed.
  const tidy = (perkLevels: Build['perks'], known: Map<string, Perk>): Pick<Build, 'perks' | 'hotbar'> => ({
    perks: perkLevels,
    hotbar: build.hotbar.map((skill) => {
      const learned = skill && known.has(skill.spell) ? (perkLevels[skill.spell] ?? 0) : 0;
      return learned ? { ...skill!, supports: skill!.supports.slice(0, supportSlots(learned, level, core.linkLevels)) } : null;
    }),
  });

  const setRank = (perk: Perk, value: number) => {
    const next = Math.max(0, Math.min(value, maxRank(perk, level), rank(perk.id) + Math.max(0, left(perk))));
    const { [perk.id]: _, ...others } = build.perks;
    change(tidy(next ? { ...others, [perk.id]: next } : others, perks));
  };

  const setClass = (index: number, id: string) => {
    const next = build.classes.filter((c, i) => i !== index && c !== id);
    if (id) next.splice(index, 0, id);
    const known = new Map(next.flatMap((c) => data.classes.find((x) => x.id === c)?.perks ?? []).map((perk) => [perk.id, perk] as const));
    change({ classes: next, ...tidy(Object.fromEntries(Object.entries(build.perks).filter(([perk]) => known.has(perk))), known) });
  };

  const setSkill = (index: number, skill: Skill | null) => change({ hotbar: build.hotbar.map((s, i) => (i === index ? skill : s)) });

  const shown = perks.get(hovered) ?? perks.get(selected);
  const skill = build.hotbar[slot];
  const skillPerk = skill && perks.get(skill.spell);
  const open = skillPerk ? supportSlots(rank(skillPerk.id), level, core.linkLevels) : 0;

  const spellChoices = (): Choice[] =>
    classes.flatMap((c) =>
      c.perks
        .filter((perk) => perk.spell && rank(perk.id) > 0)
        .map((perk) => ({
          id: perk.id,
          name: perk.spell!.name,
          icon: perk.icon,
          group: c.name,
          note: `Level ${rank(perk.id)}`,
          off: build.hotbar.some((s, i) => s?.spell === perk.id && i !== picking!.slot) ? 'Already on the hotbar' : undefined,
        })),
    );

  const supportChoices = (): Choice[] => {
    const others = skill!.supports.filter((_, i) => i !== picking!.support).map((s) => data.supports.find((x) => x.id === s.id));
    return data.supports.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      part: { stats: s.stats, rolls: exactly(100), level },
      note: `Costs ${s.cost}% as much to cast`,
      off:
        s.minLevel > level
          ? `Needs level ${s.minLevel}`
          : others.includes(s)
            ? 'Already on this skill'
            : s.oneKind && others.some((o) => o?.oneKind === s.oneKind)
              ? `Only one ${s.oneKind} support per skill`
              : undefined,
    }));
  };

  const detail = (perk: Perk) => {
    const at = rank(perk.id);
    const cap = maxRank(perk, level);
    const spell = perk.spell;
    // An unlearned perk is described at its first level.
    const shownAt = Math.max(1, at + bonus(perk));
    const levelCap = (
      <span className="cap">
        At level {shownAt}
        {bonus(perk) > 0 && ` (${at} + ${bonus(perk)} from the build)`}
      </span>
    );
    const top = spell ? spell.maxLevel + data.bonusLevels : 0;
    const fill = (desc: string) =>
      desc.split(/\[calc:(\w+)\]/).map((piece, i) =>
        i % 2 ? (
          <span key={i} className="v">
            {calcText(spell!.calcs[piece], shownAt, top, level)}
          </span>
        ) : (
          piece
        ),
      );
    return (
      <>
        <div className="perk-head">
          <img className="sprite" src={perk.icon} alt="" width={40} height={40} />
          <div>
            <div className="item-name">{perkName(perk, level)}</div>
            <div className="cap">
              {spell ? 'Spell' : 'Passive'} / Opens at level {perk.level}
            </div>
          </div>
        </div>
        <div className="stepper perk-stepper">
          <button className="btn" type="button" aria-label="Lower level" disabled={!at} onClick={() => setRank(perk, at - 1)}>
            -
          </button>
          <span className="in">
            {at}/{perk.maxLevel}
          </span>
          <button className="btn" type="button" aria-label="Raise level" disabled={at >= cap || left(perk) <= 0} onClick={() => setRank(perk, at + 1)}>
            +
          </button>
          <button className="btn ten" type="button" disabled={at >= cap || left(perk) <= 0} onClick={() => setRank(perk, perk.maxLevel)}>
            Max
          </button>
        </div>
        {cap < perk.maxLevel && <p className="open">{cap ? `At level ${level} it can go up to level ${cap}.` : `Needs level ${perk.level}.`}</p>}
        {spell ? (
          <>
            <div className="item-part">
              {levelCap}
              <p className="spell-desc">{fill(spell.desc)}</p>
              {spell.linked && (
                <p className="spell-desc">
                  <strong>{spell.linked.name}</strong>: {fill(spell.linked.desc)}
                </p>
              )}
              {spell.stats.length > 0 && <StatLines stats={spell.stats} rolls={exactly(Math.trunc(Math.fround(shownAt / top) * 100))} level={level} />}
            </div>
            <dl className="facts item-part">
              {[
                ...(['mana', 'energy'] as const).map((type) => [type === 'mana' ? 'Mana' : 'Energy', cost(spell, type, shownAt, top, data.costScaling, level)] as const).filter(([, value]) => value > 0),
                ...spell.facts,
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="cap">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="tags item-part">
              {spell.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="item-part">
            {levelCap}
            {perk.stats.map((s, i) => (
              <span key={i} className="line">
                <StatLine line={formatRange(s, rolled(s, 100, level) * shownAt, rolled(s, 100, level) * shownAt)} />
              </span>
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="plan plain">
      <div className="parts">
        <div className="title-row">
          <h1>Skills</h1>
          {pools.map((pool) => (
            <span key={pool.id} className={`count ${pool.spent > pool.total ? 'over' : ''}`}>
              {pool.spent} / {pool.total} {pool.label.toLowerCase()}
            </span>
          ))}
          {reset}
        </div>

        <div className="controls">
          {Array.from({ length: Math.min(MAX_CLASSES, classes.length + 1) }, (_, i) => (
            <Dropdown
              key={i}
              className="class"
              label={i ? 'Second class' : 'Class'}
              value={classes[i]?.id ?? ''}
              groups={[
                {
                  options: [
                    { value: '', label: i ? 'None' : 'Choose a class' },
                    ...data.classes.filter((c) => c === classes[i] || !classes.includes(c)).map((c) => ({ value: c.id, label: c.name, icon: c.icon })),
                  ],
                },
              ]}
              onChange={(id) => setClass(i, id)}
            />
          ))}
          <details className="more">
            <summary className="btn">Bonus points</summary>
            <div className="more-body">
              {pools.map((pool) => (
                <NumberField
                  key={pool.id}
                  label={pool.label}
                  value={build.bonus[pool.id]}
                  min={0}
                  max={core.points[pool.id].maxBonus}
                  onChange={(n) => change({ bonus: { ...build.bonus, [pool.id]: n } })}
                />
              ))}
            </div>
          </details>
        </div>

        {classes.length === 0 && <p className="note">Choose a class to learn its spells and passives. A build has one class or two.</p>}
        {classes.length === 1 && (
          <p className="note">
            With a single class the character gets {SOLO_CLASS.moreDamage}% more damage and {SOLO_CLASS.damageReduction}% damage reduction.
          </p>
        )}

        {classes.length > 0 && (
          <section className="group">
            <div className="group-head">
              <h2>Hotbar</h2>
              <span className="count">
                {build.hotbar.filter(Boolean).length}/{build.hotbar.length}
              </span>
            </div>
            <div className="hotbar">
              {build.hotbar.map((s, i) => {
                const perk = s && perks.get(s.spell);
                return (
                  <button
                    key={i}
                    className="hot-slot"
                    type="button"
                    aria-pressed={i === slot}
                    aria-label={perk ? `Slot ${i + 1}: ${perk.spell!.name}` : `Slot ${i + 1}: empty`}
                    onClick={() => {
                      setSlot(i);
                      if (!perk) setPicking({ slot: i });
                    }}
                  >
                    {perk ? <img className="sprite" src={perk.icon} alt="" width={32} height={32} /> : '+'}
                    {perk && s.supports.length > 0 && <span className="hot-links">{s.supports.length}</span>}
                  </button>
                );
              })}
            </div>
            {skillPerk ? (
              <>
                <div className="hot-skill">
                  <strong>{skillPerk.spell!.name}</strong>
                  <span className="cap">
                    Level {rank(skillPerk.id) + bonus(skillPerk)}
                    {bonus(skillPerk) > 0 && ` (${rank(skillPerk.id)} + ${bonus(skillPerk)})`} / {open} of {SUPPORT_SLOTS} support slots open
                  </span>
                  <button className="btn" type="button" onClick={() => setPicking({ slot })}>
                    Change
                  </button>
                  <button className="btn" type="button" onClick={() => setSkill(slot, null)}>
                    Remove
                  </button>
                </div>
                <ul className="slots">
                  {Array.from({ length: SUPPORT_SLOTS }, (_, i) => {
                    const label = `Support ${i + 1}`;
                    const placed = skill!.supports[i];
                    const support = placed && data.supports.find((s) => s.id === placed.id);
                    if (!support) {
                      // A slot opens with the character's level and with the skill's own.
                      const locked =
                        i < open
                          ? undefined
                          : level < core.linkLevels[i]
                            ? `Opens at level ${core.linkLevels[i]}`
                            : `Opens when ${skillPerk.spell!.name} is level ${(i + 1) * 4}`;
                      return <Slot key={i} label={label} locked={locked} onPick={() => setPicking({ slot, support: i })} />;
                    }
                    const roll = placed.roll ?? 100;
                    const set = (supports: Skill['supports']) => setSkill(slot, { ...skill!, supports });
                    return (
                      <Slot
                        key={i}
                        label={label}
                        name={
                          <span className="socket-name">
                            <img className="socket-sprite" src={support.icon} alt="" width={24} height={24} />
                            {support.name}
                          </span>
                        }
                        onRemove={() => set(skill!.supports.filter((_, j) => j !== i))}
                        roll={rolls ? { value: roll, min: 0, max: 100, onChange: (r) => set(skill!.supports.map((s, j) => (j === i ? { ...s, roll: r } : s))) } : undefined}
                      >
                        <StatLines stats={support.stats} rolls={exactly(roll)} level={level} />
                      </Slot>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="empty">Pick a slot to put a learned spell in it. Each skill on the hotbar holds its own support gems.</p>
            )}
          </section>
        )}

        {classes.map((c) => {
          const columns = Math.max(...c.perks.map((p) => p.x));
          const used = new Set(c.perks.map((p) => p.x));
          const rows = [...new Set(c.perks.map((p) => p.y))].sort((a, b) => a - b);
          return (
            <section key={c.id} className="group">
              <div className="group-head">
                <img src={c.icon} alt="" width={36} height={36} />
                <h2>{c.name}</h2>
              </div>
              <div
                className="perk-grid"
                style={{ gridTemplateColumns: `56px ${Array.from({ length: columns }, (_, i) => (used.has(i + 1) ? '48px' : '10px')).join(' ')}` }}
                onPointerLeave={() => setHovered('')}
              >
                {rows.map((y) => (
                  <span key={y} className={`cap perk-row ${level < c.perks.find((p) => p.y === y)!.level ? 'never' : ''}`} style={{ gridRow: y + 1 }}>
                    Lv {c.perks.find((p) => p.y === y)!.level}
                  </span>
                ))}
                {c.perks.map((perk) => {
                  const at = rank(perk.id);
                  return (
                    <button
                      key={perk.id}
                      type="button"
                      className={`perk ${at ? 'on' : ''} ${level < perk.level ? 'locked' : ''} ${perk.spell ? '' : 'passive'}`}
                      style={{ gridColumn: perk.x + 1, gridRow: perk.y + 1 }}
                      aria-label={`${perkName(perk, level)}, level ${at} of ${perk.maxLevel}`}
                      aria-pressed={perk.id === selected}
                      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(perk.id)}
                      onClick={() => {
                        setSelected(perk.id);
                        setRank(perk, at + 1);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelected(perk.id);
                        setRank(perk, at - 1);
                      }}
                    >
                      <img src={perk.icon} alt="" width={32} height={32} />
                      <span className="perk-rank">{at > 0 ? `${at}/${perk.maxLevel}` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {classes.length > 0 && <p className="note">Click a spell or passive to put a point in it, right-click to take one back.</p>}
      </div>

      {classes.length > 0 && (
        <aside className="item" aria-label="Selected spell or passive">
          {shown ? detail(shown) : <p className="open">Point at a spell or passive to see what it does.</p>}
        </aside>
      )}

      {picking && picking.support === undefined && (
        <Picker title="Choose a learned spell" choices={spellChoices()} onClose={() => setPicking(null)} onPick={(id) => setSkill(picking.slot, { spell: id, supports: [] })} />
      )}
      {picking && picking.support !== undefined && (
        <Picker
          title="Choose a support gem"
          choices={supportChoices()}
          onClose={() => setPicking(null)}
          onPick={(id) => {
            const supports = [...skill!.supports];
            supports[Math.min(picking.support!, supports.length)] = { id };
            setSkill(slot, { ...skill!, supports });
          }}
        />
      )}
    </div>
  );
}

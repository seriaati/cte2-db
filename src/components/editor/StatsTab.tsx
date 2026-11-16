import type { CSSProperties } from 'react';
import { pointsAt } from '../../lib/buildRules';
import { NumberField, type TabProps } from './shared';

export default function StatsTab({ core, build, change }: TabProps) {
  const pool = core.points.stats;
  const total = pointsAt(pool, build.level, build.bonus.stats);
  const spent = Object.values(build.stats).reduce((sum, n) => sum + n, 0);
  const left = total - spent;
  const set = (id: string, value: number) => {
    const others = spent - (build.stats[id] ?? 0);
    change({ stats: { ...build.stats, [id]: Math.max(0, Math.min(value || 0, total - others)) } });
  };

  return (
    <div className="plain">
      <div className="title-row">
        <h1>Stat points</h1>
        <span className={`count ${left < 0 ? 'over' : ''}`}>
          {spent} / {total} points
        </span>
      </div>
      <div className="controls">
        {pool.maxBonus > 0 && (
          <NumberField label="Bonus points" value={build.bonus.stats} min={0} max={pool.maxBonus} onChange={(n) => change({ bonus: { ...build.bonus, stats: n } })} />
        )}
      </div>

      <ul className="attributes">
        {core.attributes.map((stat) => {
          const value = build.stats[stat.id] ?? 0;
          return (
            <li key={stat.id} className="attribute">
              <div>
                <h2>
                  <span className="perk-icon" style={{ '--icon': stat.icon } as CSSProperties} />
                  {stat.name}
                </h2>
                <p>{stat.desc}</p>
              </div>
              <div className="stepper">
                <button className="btn ten" type="button" aria-label={`Lower ${stat.name} by 10`} disabled={!value} onClick={() => set(stat.id, value - 10)}>
                  -10
                </button>
                <button className="btn" type="button" aria-label={`Lower ${stat.name}`} disabled={!value} onClick={() => set(stat.id, value - 1)}>
                  -
                </button>
                <input className="in" type="number" min={0} max={value + Math.max(0, left)} value={value} aria-label={stat.name} onChange={(e) => set(stat.id, Math.trunc(e.target.valueAsNumber))} />
                <button className="btn" type="button" aria-label={`Raise ${stat.name}`} disabled={left <= 0} onClick={() => set(stat.id, value + 1)}>
                  +
                </button>
                <button className="btn ten" type="button" aria-label={`Raise ${stat.name} by 10`} disabled={left <= 0} onClick={() => set(stat.id, value + 10)}>
                  +10
                </button>
                <button className="btn ten" type="button" aria-label={`Put every point left in ${stat.name}`} disabled={left <= 0} onClick={() => set(stat.id, value + left)}>
                  Max
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

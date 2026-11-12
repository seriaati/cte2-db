import { formatStat, type Rarity, type StatMod } from '../lib/affix';

export function StatLine({ line }: { line: { value: string; label: string; desc: string } }) {
  return (
    <>
      <span className="v">{line.value}</span>{' '}
      {line.desc ? (
        <span className="tip" data-tip={line.desc}>
          {line.label}
        </span>
      ) : (
        line.label
      )}
    </>
  );
}

export function StatLines({ stats, rolls, level }: { stats: StatMod[]; rolls: Rarity; level: number }) {
  return stats.map((stat, i) => (
    <span key={i} className="line">
      <StatLine line={formatStat(stat, rolls, level)} />
    </span>
  ));
}

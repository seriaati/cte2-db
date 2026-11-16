import { useMemo, useState } from 'react';
import { TREES, type TreeId } from '../../lib/buildRules';
import { neighbours, rooted } from '../../lib/talentRules';
import { TreeEditor } from '../TalentTree';
import { Loading, useSection, type TabProps } from './shared';

const LABELS: Record<TreeId, string> = { talents: 'Talents', ascendancy: 'Ascendancy', atlas: 'Atlas' };

export default function TalentsTab({ core, build, change }: TabProps) {
  const [id, setId] = useState<TreeId>('talents');
  const tree = useSection(id);
  // A build made on another pack release can hold talents that no longer connect; those start over.
  const nodes = useMemo(() => {
    if (!tree) return [];
    const taken = new Set(build.trees[id].filter((n) => n < tree.nodes.length));
    return rooted(tree, neighbours(tree), taken).size === taken.size ? [...taken] : [];
  }, [tree, build.trees[id]]);

  const nav = (
    <div className="seg" role="group" aria-labelledby="tree-label">
      {TREES.map((t) => (
        <button key={t} className="btn" type="button" aria-pressed={t === id} onClick={() => setId(t)}>
          {LABELS[t]}
          <span className="seg-count">{build.trees[t].length}</span>
        </button>
      ))}
    </div>
  );

  if (!tree) return <Loading />;
  return (
    <TreeEditor
      key={id}
      tree={tree}
      level={build.level}
      bonus={build.bonus[id]}
      nodes={nodes}
      onBonus={(bonus) => change({ bonus: { ...build.bonus, [id]: bonus } })}
      onNodes={(next) => change({ trees: { ...build.trees, [id]: next } })}
      nav={nav}
      maxLevel={core.maxLevel}
    />
  );
}

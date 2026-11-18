import { useMemo, useState } from 'react';
import { connected } from '../../lib/buildCalc';
import { TREES, TREE_NAMES, type TreeId } from '../../lib/buildRules';
import { TreeEditor } from '../TalentTree';
import { Loading, useSection, type TabProps } from './shared';

export default function TalentsTab({ core, build, change, reset }: TabProps) {
  const [id, setId] = useState<TreeId>('talents');
  const tree = useSection(id);
  const nodes = useMemo(() => (tree ? connected(tree, build.trees[id]) : []), [tree, build.trees[id]]);

  // This tab has no heading of its own, so the button that empties all three trees sits by the tree picker.
  const nav = (
    <div className="tree-nav">
      <div className="seg" role="group" aria-labelledby="tree-label">
        {TREES.map((t) => (
          <button key={t} className="btn" type="button" aria-pressed={t === id} onClick={() => setId(t)}>
            {TREE_NAMES[t]}
            <span className="seg-count">{build.trees[t].length}</span>
          </button>
        ))}
      </div>
      {reset}
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

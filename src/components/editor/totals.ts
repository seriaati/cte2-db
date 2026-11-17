import { useMemo } from 'react';
import { buildTotals, type Data, type Totals } from '../../lib/buildCalc';
import type { Build } from '../../lib/buildRules';
import { useSection } from './shared';

// The game data a build's stats are worked out from. Null until all of it has arrived.
export function useData(): Data | null {
  const data = {
    stats: useSection('stats'),
    gear: useSection('gear'),
    skills: useSection('skills'),
    sockets: useSection('sockets'),
    talents: useSection('talents'),
    ascendancy: useSection('ascendancy'),
    atlas: useSection('atlas'),
  };
  return useMemo(() => (Object.values(data).some((section) => !section) ? null : (data as Data)), Object.values(data));
}

// What the whole build's stats come to. Null until the game data has arrived.
export function useTotals(build: Build): Totals | null {
  const data = useData();
  return useMemo(() => data && buildTotals(data, build), [data, build]);
}

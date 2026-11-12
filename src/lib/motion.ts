import { useEffect, useRef } from 'react';

// Animations started from code have to check the visitor's motion setting themselves; the
// stylesheet's reduced-motion rule only reaches CSS animations and transitions.
export function play(el: Element | null, keyframes: Keyframe[], duration: number) {
  if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) el.animate(keyframes, { duration, easing: 'ease-out' });
}

// Replays a short fade-in on an element whenever `dep` changes, to mark that its content was swapped.
export function useSwap<T extends Element>(dep: unknown) {
  const ref = useRef<T>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else play(ref.current, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 180);
  }, [dep]);
  return ref;
}

import { useEffect, useState } from 'react';

// State kept in localStorage, so a choice carries across pages and reloads. The stored value is
// read after mount because the server-rendered page can only know the default.
export function useStored<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    // Storage access throws when the browser blocks it; the page then just keeps its defaults.
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored));
    } catch {}
  }, [key]);
  const store = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return [value, store];
}

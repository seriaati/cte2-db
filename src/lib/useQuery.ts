import { useEffect, useState } from 'react';

// A list's search text. Site search links to an entry as ?q=<text>, which is read after mount
// because the server-rendered page can't know the address it will be opened with.
export function useQuery(): [string, (value: string) => void] {
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(new URLSearchParams(location.search).get('q') ?? ''), []);
  return [query, setQuery];
}

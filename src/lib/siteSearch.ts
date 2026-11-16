// Client-side: the search dialog in Layout.astro. Page changes swap the body, so nothing is bound to
// an element: every listener sits on the document and finds the dialog again.

// The icon is a sprite's address or a cell of the talent icon sheet; without one the row gets its
// page's menu icon. The last item is what the page's own search box finds the entry by, when that
// isn't its title.
export type Row = [title: string, lines: string[], icon?: string | number | null, find?: string];

export interface Group {
  name: string;
  href: string;
  // Set where the page has no search box to hand an entry to.
  plain?: boolean;
  rows: Row[];
}

const SHOWN = 5;

let index: Promise<Group[]> | undefined;

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.search')!;
const esc = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const row = (href: string, icon: string, title: string, lines: string[] = []) =>
  `<a class="search-row" href="${esc(href)}"><span class="search-icon">${icon}</span><span><strong>${esc(title)}</strong>${lines.length ? `<small>${esc(lines.join(' · '))}</small>` : ''}</span></a>`;

const section = (name: string, rows: string[]) => (rows.length ? `<section><h2 class="cap">${name}</h2>${rows.join('')}</section>` : '');

function open() {
  index ??= fetch('/search.json')
    .then((r) => r.json())
    // Left unset after a failure so that opening the search again retries.
    .catch(() => ((index = undefined), []));
  if (!dialog().open) dialog().showModal();
  dialog().querySelector('input')!.select();
}

async function render() {
  const groups = (await index) ?? [];
  const q = dialog().querySelector('input')!.value.trim().toLowerCase();
  const tabs = [...document.querySelectorAll('#site-nav a')].map((a) => ({
    href: a.getAttribute('href')!,
    icon: a.querySelector('svg')!.outerHTML,
    label: a.querySelector('svg')!.nextSibling!.textContent!.trim(),
  }));
  const has = (text: string) => text.toLowerCase().includes(q);
  // Entries whose title matches come first, the earlier in the title the better.
  const rank = ([title]: Row) => (has(title) ? title.toLowerCase().indexOf(q) : 1000);

  const pages = tabs.filter((t) => has(`${t.label} ${t.href}`)).map((t) => row(t.href, t.icon, t.label));
  const lists = groups.map((group) => {
    const found = group.rows.filter(([title, lines]) => has(title) || lines.some(has)).sort((a, b) => rank(a) - rank(b));
    const icon = tabs.find((t) => group.href.startsWith(t.href))?.icon ?? '';
    const link = (find: string) => (group.plain ? group.href : `${group.href}?q=${encodeURIComponent(find)}`);
    const rows = found.slice(0, SHOWN).map(([title, lines, sprite, find]) => {
      const matching = lines.filter(has);
      const image = typeof sprite === 'string' ? `<img src="${sprite}" alt="" width="32" height="32">` : typeof sprite === 'number' ? `<i style="--icon: ${sprite}"></i>` : icon;
      return row(link(find ?? title), image, title, matching.length ? matching : lines);
    });
    if (found.length > SHOWN) rows.push(`<a class="search-row more cap" href="${esc(link(q))}">${found.length - SHOWN} more</a>`);
    return section(group.name, rows);
  });

  dialog().querySelector('.search-results')!.innerHTML = q ? section('Pages', pages) + lists.join('') : '';
  move(0);
}

function activate(row?: Element) {
  dialog().querySelector('.search-row.active')?.classList.remove('active');
  row?.classList.add('active');
}

function move(step: number) {
  const rows = [...dialog().querySelectorAll('.search-row')];
  const next = rows[Math.max(0, Math.min(rows.length - 1, rows.findIndex((r) => r.matches('.active')) + step))];
  activate(next);
  next?.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('click', (e) => {
  const target = e.target as Element;
  if (target.closest('[data-search]')) open();
  // A click on the dialog itself lands on its backdrop. A result closes it too, because a link to
  // the page that is already open doesn't swap the body.
  else if (target === dialog() || target.closest('.search-row')) dialog().close();
});

document.addEventListener('input', (e) => {
  if ((e.target as Element).closest('dialog.search')) render();
});

// Only a real pointer move picks a row, not the list scrolling under a pointer at rest.
document.addEventListener('pointermove', (e) => {
  const row = (e.target as Element).closest('.search-row');
  if (row) activate(row);
});

document.addEventListener('keydown', (e) => {
  const target = e.target as Element;
  const searching = target.closest('dialog.search input');
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !target.closest('input, textarea, select'))) {
    e.preventDefault();
    open();
  } else if (searching && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    move(e.key === 'ArrowDown' ? 1 : -1);
  } else if (searching && e.key === 'Enter') {
    e.preventDefault();
    dialog().querySelector<HTMLElement>('.search-row.active')?.click();
  }
});

// Client-side: the search dialog in Layout.astro, the search box that takes its place on the home page,
// and the home page's list of what was opened last. Page changes swap the body, so nothing is bound
// to an element: every listener sits on the document and finds its elements again.

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

// A page or entry that was opened, newest first. The icon is as in Row.
type Recent = [href: string, title: string, icon?: string | number];

const SHOWN = 5;
const REMEMBERED = 8;
// A search box and its results sit together in one of these.
const BOXES = 'dialog.search, .home-search';

let index: Promise<Group[]> | undefined;

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.search')!;
const homeBox = () => document.querySelector<HTMLInputElement>('.home-search input');
const tabs = () =>
  [...document.querySelectorAll('#site-nav a')].map((a) => ({
    href: a.getAttribute('href')!,
    icon: a.querySelector('svg')!.outerHTML,
    label: a.querySelector('svg')!.nextSibling!.textContent!.trim(),
  }));
const image = (icon: Row[2], fallback = '') =>
  typeof icon === 'string' ? `<img src="${icon}" alt="" width="32" height="32">` : typeof icon === 'number' ? `<i style="--icon: ${icon}"></i>` : fallback;
const esc = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const row = (href: string, icon: string, title: string, lines: string[] = []) =>
  `<a class="search-row" href="${esc(href)}"><span class="search-icon">${icon}</span><span><strong>${esc(title)}</strong>${lines.length ? `<small>${esc(lines.join(' · '))}</small>` : ''}</span></a>`;

const section = (name: string, rows: string[]) => (rows.length ? `<section><h2 class="cap">${name}</h2>${rows.join('')}</section>` : '');

function load() {
  index ??= fetch('/search.json')
    .then((r) => r.json())
    // Left unset after a failure so that the next search retries.
    .catch(() => ((index = undefined), []));
}

function open() {
  load();
  if (homeBox()) return homeBox()!.select();
  if (!dialog().open) dialog().showModal();
  dialog().querySelector('input')!.select();
}

async function render(box: Element) {
  load();
  const groups = (await index) ?? [];
  const q = box.querySelector('input')!.value.trim().toLowerCase();
  const pageTabs = tabs();
  const has = (text: string) => text.toLowerCase().includes(q);
  // Entries whose title matches come first, the earlier in the title the better.
  const rank = ([title]: Row) => (has(title) ? title.toLowerCase().indexOf(q) : 1000);

  const pages = pageTabs.filter((t) => has(`${t.label} ${t.href}`)).map((t) => row(t.href, t.icon, t.label));
  const lists = groups.map((group) => {
    const found = group.rows.filter(([title, lines]) => has(title) || lines.some(has)).sort((a, b) => rank(a) - rank(b));
    const icon = pageTabs.find((t) => group.href.startsWith(t.href))?.icon ?? '';
    const link = (find: string) => (group.plain ? group.href : `${group.href}?q=${encodeURIComponent(find)}`);
    const rows = found.slice(0, SHOWN).map(([title, lines, sprite, find]) => {
      const matching = lines.filter(has);
      return row(link(find ?? title), image(sprite, icon), title, matching.length ? matching : lines);
    });
    if (found.length > SHOWN) rows.push(`<a class="search-row more cap" href="${esc(link(q))}">${found.length - SHOWN} more</a>`);
    return section(group.name, rows);
  });

  box.querySelector('.search-results')!.innerHTML = q ? section('Pages', pages) + lists.join('') : '';
  move(box, 0);
}

function activate(box: Element, row?: Element) {
  box.querySelector('.search-row.active')?.classList.remove('active');
  row?.classList.add('active');
}

function move(box: Element, step: number) {
  const rows = [...box.querySelectorAll('.search-row')];
  const next = rows[Math.max(0, Math.min(rows.length - 1, rows.findIndex((r) => r.matches('.active')) + step))];
  activate(box, next);
  next?.scrollIntoView({ block: 'nearest' });
}

// Storage access throws when the browser blocks it; then nothing is remembered.
function recents(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem('recent') ?? '[]');
  } catch {
    return [];
  }
}

function remember(opened: Recent) {
  try {
    localStorage.setItem('recent', JSON.stringify([opened, ...recents().filter(([href]) => href !== opened[0])].slice(0, REMEMBERED)));
  } catch {}
}

function showRecents() {
  const list = document.querySelector<HTMLElement>('.home-recent');
  if (!list) return;
  const pageTabs = tabs();
  const rows = recents().map(([href, title, icon]) => {
    const tab = pageTabs.find((t) => href.startsWith(t.href));
    // An entry is told from a page by the search text its address carries.
    return row(href, image(icon, tab?.icon), title, href.includes('?') && tab ? [tab.label] : []);
  });
  list.hidden = rows.length === 0;
  list.querySelector('.recent-rows')!.innerHTML = rows.join('');
}

document.addEventListener('astro:page-load', () => {
  const tab = document.querySelector('#site-nav a[aria-current]');
  if (tab && !location.search) remember([tab.getAttribute('href')!, tab.querySelector('svg')!.nextSibling!.textContent!.trim()]);
  showRecents();
});

document.addEventListener('click', (e) => {
  const target = e.target as Element;
  if (target.closest('[data-search]')) open();
  // A click on the dialog itself lands on its backdrop. A result closes it too, because a link to
  // the page that is already open doesn't swap the body.
  else if (target === dialog() || target.closest('.search-row')) dialog().close();
  const opened = target.closest('a.search-row:not(.more)');
  if (opened) {
    const sprite = opened.querySelector('.search-icon img')?.getAttribute('src');
    const cell = opened.querySelector<HTMLElement>('.search-icon i')?.style.getPropertyValue('--icon');
    remember([opened.getAttribute('href')!, opened.querySelector('strong')!.textContent!, sprite ?? (cell ? +cell : undefined)]);
  }
});

document.addEventListener('input', (e) => {
  const box = (e.target as Element).closest(BOXES);
  if (box) render(box);
});

// Only a real pointer move picks a row, not the list scrolling under a pointer at rest.
document.addEventListener('pointermove', (e) => {
  const row = (e.target as Element).closest('.search-row');
  const box = row?.closest(BOXES);
  if (box) activate(box, row!);
});

document.addEventListener('keydown', (e) => {
  const target = e.target as Element;
  const box = target.matches('input') ? target.closest(BOXES) : null;
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !target.closest('input, textarea, select'))) {
    e.preventDefault();
    open();
  } else if (box && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    move(box, e.key === 'ArrowDown' ? 1 : -1);
  } else if (box && e.key === 'Enter') {
    e.preventDefault();
    box.querySelector<HTMLElement>('.search-row.active')?.click();
  }
});

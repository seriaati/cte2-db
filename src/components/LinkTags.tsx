import type { Link } from '../lib/effects';

export function LinkTags({ label, links }: { label: string; links: Link[] }) {
  if (links.length === 0) return null;
  return (
    <div className="tags links">
      <span className="cap">{label}</span>
      {links.map((link) =>
        link.href ? (
          <a key={link.href} className="tag" href={link.href}>
            {link.name}
          </a>
        ) : (
          <span key={link.name} className="tag">
            {link.name}
          </span>
        ),
      )}
    </div>
  );
}

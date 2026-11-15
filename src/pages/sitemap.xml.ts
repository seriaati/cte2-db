import type { APIRoute } from 'astro';

// Every page is a single .astro file in this folder or below it, so the file paths are the site's routes.
// Pages are built as folders, so every address but the home page ends in a slash, as the canonical links do.
const paths = Object.keys(import.meta.glob('./**/*.astro')).map((file) => file.replace(/^\.\/(index\.astro$)?/, '/').replace(/\.astro$/, '/'));

export const GET: APIRoute = ({ site }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
      .sort()
      .map((path) => `  <url><loc>${new URL(path, site)}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml' } },
  );

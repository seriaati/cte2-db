import type { APIRoute } from 'astro';
import { sections } from '../../lib/builds';

// The build editor's game data, one file per part of the editor.
export const getStaticPaths = () => Object.keys(sections).map((section) => ({ params: { section } }));

export const GET: APIRoute = ({ params }) => Response.json(sections[params.section as keyof typeof sections]);

import type { APIRoute } from 'astro';
import { store } from '../../../lib/store';
import { createImport, listImports } from '../../../server/imports';
import { readJsonBody } from '../../../server/http';

export const GET: APIRoute = () => listImports(store());
export const POST: APIRoute = async ({ request }) => createImport(store(), await readJsonBody(request));

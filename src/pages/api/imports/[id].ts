import type { APIRoute } from 'astro';
import { store } from '../../../lib/store';
import { deleteImport, getImport } from '../../../server/imports';

export const GET: APIRoute = ({ params }) => getImport(store(), params.id ?? '');
export const DELETE: APIRoute = ({ params }) => deleteImport(store(), params.id ?? '');

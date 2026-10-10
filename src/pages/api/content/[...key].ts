import type { APIRoute } from 'astro';
import { getContent } from '../../../server/content';

export const GET: APIRoute = ({ params, locals }) => getContent(params.key ?? '', locals.role);

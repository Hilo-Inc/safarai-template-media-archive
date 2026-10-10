import type { APIRoute } from 'astro';
import { store } from '../../../../lib/store';
import { readJsonBody } from '../../../../server/http';
import { signUpload } from '../../../../server/imports';

export const POST: APIRoute = async ({ params, request }) => signUpload(store(), params.id ?? '', await readJsonBody(request));

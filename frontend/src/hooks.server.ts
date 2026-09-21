import type { Handle } from '@sveltejs/kit';

// wafmgmt now runs as a single Bun process (apps/server) that mounts every
// module: core, usp and terminal. The frontend only needs one backend URL.
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000';

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;

  if (pathname.startsWith('/api/') || pathname.startsWith('/logo') || pathname.startsWith('/brand')) {
    const targetUrl = `${BACKEND_URL}${pathname}${search}`;
    try {
      const resp = await fetch(targetUrl, {
        method: event.request.method,
        headers: event.request.headers,
        body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.arrayBuffer() : undefined,
      });
      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: `Backend Unreachable: ${err.message}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return resolve(event);
};

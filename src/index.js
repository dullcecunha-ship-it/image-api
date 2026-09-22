export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'GET') {
      return Response.json({ status: 'online' }, { headers: cors });
    }

    if (url.pathname === '/api/image' && request.method === 'GET') {
      const prompt = url.searchParams.get('prompt');
      const steps = Math.min(Math.max(parseInt(url.searchParams.get('steps')) || 4, 1), 8);
      const key = url.searchParams.get('key');

      if (!env.API_KEY || key !== env.API_KEY) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
      }
      if (!prompt) {
        return Response.json({ error: 'prompt required' }, { status: 400, headers: cors });
      }

      try {
        const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt,
          steps,
          safety: false,
        });
        const binary = Uint8Array.from(atob(out.image), c => c.charCodeAt(0));
        return new Response(binary, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600',
            ...cors,
          },
        });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500, headers: cors });
      }
    }

    if (url.pathname === '/api/image' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const key = auth.replace('Bearer ', '').trim();
      if (!env.API_KEY || key !== env.API_KEY) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
      }
      let body;
      try { body = await request.json(); } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors });
      }
      const prompt = (body?.prompt || '').toString().trim();
      if (!prompt) {
        return Response.json({ error: 'prompt required' }, { status: 400, headers: cors });
      }
      const steps = Math.min(Math.max(parseInt(body.steps) || 4, 1), 8);
      try {
        const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt,
          steps,
          safety: false,
        });
        return Response.json({
          success: true,
          image: `data:image/png;base64,${out.image}`,
          prompt,
          steps,
        }, { headers: cors });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500, headers: cors });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
  },
};

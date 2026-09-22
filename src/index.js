// ============================================
// IMAGE API — Pollinations backend
// GET  /api/image?prompt=...&key=...&steps=...&width=...&height=...&crop=true
// POST /api/image  { prompt, steps, width, height, crop }
// ============================================

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

    // ---------- Health ----------
    if (url.pathname === '/' && request.method === 'GET') {
      return Response.json({ status: 'online', backend: 'pollinations' }, { headers: cors });
    }

    // ---------- GET /api/image ----------
    if (url.pathname === '/api/image' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!env.API_KEY || key !== env.API_KEY) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
      }

      const prompt = (url.searchParams.get('prompt') || '').trim();
      if (!prompt) {
        return Response.json({ error: 'prompt required' }, { status: 400, headers: cors });
      }
      if (prompt.length > 2000) {
        return Response.json({ error: 'prompt too long (max 2000 chars)' }, { status: 400, headers: cors });
      }

      const width = clampInt(url.searchParams.get('width'), 256, 1536, 1024);
      const height = clampInt(url.searchParams.get('height'), 256, 1536, 1024);
      const crop = url.searchParams.get('crop') !== 'false'; // default: crop watermark
      const model = url.searchParams.get('model') || 'flux';

      const imageUrl = buildPollinationsUrl(prompt, width, height, model, crop);

      return Response.json({
        success: true,
        image: imageUrl,
        prompt,
        width,
        height,
        cropped: crop,
        model,
      }, { headers: cors });
    }

    // ---------- POST /api/image ----------
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
      if (prompt.length > 2000) {
        return Response.json({ error: 'prompt too long (max 2000 chars)' }, { status: 400, headers: cors });
      }

      const width = clampInt(body.width, 256, 1536, 1024);
      const height = clampInt(body.height, 256, 1536, 1024);
      const crop = body.crop !== false;
      const model = body.model || 'flux';

      const imageUrl = buildPollinationsUrl(prompt, width, height, model, crop);

      return Response.json({
        success: true,
        image: imageUrl,
        prompt,
        width,
        height,
        cropped: crop,
        model,
      }, { headers: cors });
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
  },
};

// ---------- Helpers ----------

function clampInt(value, min, max, fallback) {
  const n = parseInt(value);
  if (isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function buildPollinationsUrl(prompt, width, height, model, crop) {
  const base = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model: model,
    nologo: 'true',
    seed: String(Math.floor(Math.random() * 1e9)),
  });
  const rawUrl = `${base}?${params.toString()}`;

  if (!crop) return rawUrl;

  // Crop bottom 6% where the watermark sits
  const croppedHeight = Math.floor(height * 0.94);
  return `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&w=${width}&h=${croppedHeight}&fit=cover&a=top`;
}

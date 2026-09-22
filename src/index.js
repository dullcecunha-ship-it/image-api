// ============================================
// Image Generation API v2.1.0
// Default format: raw (image displays directly)
// ============================================

const SERVICE = { name: 'image-api', version: '2.1.0' };

const STYLES = {
  photo:  { model: 'flux-realism', prefix: 'photorealistic, detailed, 85mm lens, natural lighting, ' },
  anime:  { model: 'flux-anime',   prefix: 'anime style, studio ghibli inspired, vibrant colors, ' },
  art:    { model: 'flux',         prefix: 'digital art, concept art, trending on artstation, ' },
  '3d':   { model: 'flux-3d',      prefix: '3D render, octane render, unreal engine, cinematic lighting, ' },
  dark:   { model: 'any-dark',     prefix: 'dark moody atmosphere, dramatic shadows, ' },
  fast:   { model: 'turbo',        prefix: '' },
  cinem:  { model: 'flux',         prefix: 'cinematic shot, anamorphic lens, film grain, 35mm, ' },
  paint:  { model: 'flux',         prefix: 'oil painting, impressionist style, thick brush strokes, ' },
  sketch: { model: 'flux',         prefix: 'pencil sketch, hand-drawn, cross-hatching, graphite, ' },
};

const RATIOS = {
  '1:1':  [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3':  [1152, 896],
  '3:4':  [896, 1152],
  '21:9': [1536, 640],
  '3:2':  [1216, 832],
  '2:3':  [832, 1216],
};

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
      'Access-Control-Max-Age': '86400',
    };

    const security = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'X-Request-Id': requestId,
      'X-Service-Version': SERVICE.version,
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, ...security } });
    }

    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'GET') {
      return json({
        service: SERVICE.name,
        version: SERVICE.version,
        status: 'operational',
        default_format: 'raw',
        endpoints: {
          health: 'GET /v1/health',
          styles: 'GET /v1/styles',
          ratios: 'GET /v1/ratios',
          generate: 'GET|POST /v1/image',
          sign: 'GET /v1/sign',
          short: 'GET /i/{token}',
        },
      }, 200, cors, security);
    }

    if (url.pathname === '/v1/health' && request.method === 'GET') {
      return json({ status: 'ok', timestamp: new Date().toISOString() }, 200, cors, security);
    }

    if (url.pathname === '/v1/styles' && request.method === 'GET') {
      return json({
        styles: Object.entries(STYLES).map(([id, s]) => ({
          id, model: s.model, sample: s.prefix || '(none)',
        })),
      }, 200, cors, security);
    }

    if (url.pathname === '/v1/ratios' && request.method === 'GET') {
      return json({
        ratios: Object.entries(RATIOS).map(([r, [w, h]]) => ({
          ratio: r, width: w, height: h,
        })),
      }, 200, cors, security);
    }

    // ---------- Sign URL ----------
    if (url.pathname === '/v1/sign' && request.method === 'GET') {
      const key = url.searchParams.get('key');
      if (!env.API_KEY || !key || !timingSafeEqual(key, env.API_KEY)) {
        return error(401, 'unauthorized', 'Invalid credentials', cors, security);
      }

      const prompt = (url.searchParams.get('prompt') || '').trim();
      if (!prompt) return error(400, 'invalid_request', "'prompt' is required", cors, security);

      const ttl = clampInt(url.searchParams.get('ttl'), 60, 604800, 3600);
      const exp = Math.floor(Date.now() / 1000) + ttl;

      const payload = {
        p: prompt,
        n: url.searchParams.get('negative') || '',
        s: url.searchParams.get('style') || '',
        r: url.searchParams.get('ratio') || '',
        w: url.searchParams.get('width') || '',
        h: url.searchParams.get('height') || '',
        u: url.searchParams.get('upscale') || '',
        e: url.searchParams.get('enhance') === 'true' ? 1 : 0,
        c: url.searchParams.get('crop') === 'false' ? 0 : 1,
        x: exp,
      };

      const token = await encodeToken(payload, env.SIGNING_SECRET || env.API_KEY);
      const origin = url.origin;

      return json({
        url: `${origin}/i/${token}`,
        expires: exp,
        expires_in: ttl,
      }, 200, cors, security);
    }

    // ---------- Short/redirect URL ----------
    if (url.pathname.startsWith('/i/') && request.method === 'GET') {
      const token = url.pathname.slice(3);
      const payload = await decodeToken(token, env.SIGNING_SECRET || env.API_KEY);
      if (!payload) return error(403, 'invalid_token', 'Invalid or tampered token', cors, security);
      if (payload.x < Math.floor(Date.now() / 1000)) {
        return error(410, 'expired', 'Signed URL has expired', cors, security);
      }

      const dims = resolveDimensions(payload.r, payload.w ? parseInt(payload.w) : null, payload.h ? parseInt(payload.h) : null);
      const imageUrl = buildImageUrl(
        payload.p, dims.width, dims.height, payload.s, payload.n,
        payload.e === 1, payload.c === 1, payload.u ? parseInt(payload.u) : 1, null
      );

      try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error(`Upstream ${imgRes.status}`);
        return new Response(imgRes.body, {
          status: 200,
          headers: {
            'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
            'Cache-Control': 'public, max-age=3600',
            ...cors,
            ...security,
          },
        });
      } catch {
        return error(502, 'upstream_error', 'Image could not be generated', cors, security);
      }
    }

    // ---------- Generate ----------
    if (url.pathname === '/v1/image') {
      const isGet = request.method === 'GET';
      const isPost = request.method === 'POST';
      if (!isGet && !isPost) return error(405, 'method_not_allowed', 'Use GET or POST', cors, security);

      let source, key;
      if (isGet) {
        source = url.searchParams;
        key = source.get('key');
      } else {
        let body;
        try { body = await request.json(); } catch {
          return error(400, 'invalid_request', 'Body must be valid JSON', cors, security);
        }
        source = body;
        const auth = request.headers.get('Authorization') || '';
        key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      }

      if (!env.API_KEY || !key || !timingSafeEqual(key, env.API_KEY)) {
        return error(401, 'unauthorized', 'Invalid credentials', cors, security);
      }

      const get = (n) => (source.get ? source.get(n) : source[n]);

      const prompt = String(get('prompt') || '').trim();
      if (!prompt) return error(400, 'invalid_request', "'prompt' is required", cors, security);
      if (prompt.length > 2000) return error(400, 'invalid_request', "'prompt' exceeds 2000 chars", cors, security);

      const negative = String(get('negative') || '').trim();
      const style = validateStyle(get('style'));
      if (style === null) return error(400, 'invalid_request', "'style' is not supported. GET /v1/styles", cors, security);

      const ratio = validateRatio(get('ratio'));
      if (ratio === null) return error(400, 'invalid_request', "'ratio' is not supported. GET /v1/ratios", cors, security);

      const widthOverride = get('width') ? clampInt(get('width'), 256, 1536, null) : null;
      const heightOverride = get('height') ? clampInt(get('height'), 256, 1536, null) : null;
      if (get('width') && widthOverride === null) return error(400, 'invalid_request', "'width' must be 256–1536", cors, security);
      if (get('height') && heightOverride === null) return error(400, 'invalid_request', "'height' must be 256–1536", cors, security);

      const dims = resolveDimensions(ratio, widthOverride, heightOverride);

      const n = clampInt(get('n'), 1, 4, 1);
      if (n === null) return error(400, 'invalid_request', "'n' must be 1–4", cors, security);

      const upscale = clampInt(get('upscale'), 1, 4, 1);
      if (upscale === null) return error(400, 'invalid_request', "'upscale' must be 1–4", cors, security);

      const enhance = get('enhance') === 'true' || get('enhance') === true;
      const crop = get('crop') !== 'false' && get('crop') !== false;
      const baseSeed = get('seed') ? parseInt(get('seed')) : null;

      // ---------- Format resolution ----------
      // Priority: explicit ?format= > Accept header > default 'raw'
      const explicitFormat = get('format');
      let format;
      if (explicitFormat) {
        format = String(explicitFormat).toLowerCase();
      } else {
        const accept = request.headers.get('Accept') || '';
        if (accept.includes('application/json')) format = 'json';
        else format = 'raw'; // default
      }

      const allowedFormats = ['json', 'raw', 'base64', 'markdown', 'html', 'redirect'];
      if (!allowedFormats.includes(format)) {
        return error(400, 'invalid_request', `'format' must be one of: ${allowedFormats.join(', ')}`, cors, security);
      }

      // Build all image URLs
      const images = [];
      for (let i = 0; i < n; i++) {
        const seed = baseSeed !== null ? baseSeed + i : Math.floor(Math.random() * 1e9);
        const imageUrl = buildImageUrl(prompt, dims.width, dims.height, style, negative, enhance, crop, upscale, seed);
        const actualHeight = crop ? Math.floor(dims.height * 0.94) : dims.height;
        images.push({ url: imageUrl, width: dims.width, height: actualHeight, seed });
      }

      // ---------- Response formats ----------

      if (format === 'redirect') {
        return Response.redirect(images[0].url, 302);
      }

      if (format === 'raw') {
        try {
          const imgRes = await fetch(images[0].url);
          if (!imgRes.ok) throw new Error(`Upstream ${imgRes.status}`);
          return new Response(imgRes.body, {
            status: 200,
            headers: {
              'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
              'Cache-Control': 'public, max-age=3600',
              ...cors,
              ...security,
            },
          });
        } catch {
          return error(502, 'upstream_error', 'Image could not be generated', cors, security);
        }
      }

      if (format === 'base64') {
        const results = await Promise.all(images.map(async (img) => {
          const r = await fetch(img.url);
          const buf = await r.arrayBuffer();
          const b64 = arrayBufferToBase64(buf);
          return { image: b64, mime: r.headers.get('Content-Type') || 'image/jpeg', ...img };
        }));
        return json({
          object: 'image.generation',
          id: `gen_${requestId.replace(/-/g, '').slice(0, 24)}`,
          created: Math.floor(Date.now() / 1000),
          data: results,
        }, 200, cors, security);
      }

      if (format === 'markdown') {
        const text = images.map((img, i) => `**Image ${i + 1}**\n![generated](${img.url})`).join('\n\n');
        return json({ text, images }, 200, cors, security);
      }

      if (format === 'html') {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(prompt)}</title><meta property="og:image" content="${images[0].url}"><meta property="og:title" content="${escapeHtml(prompt)}"></head><body style="font-family:system-ui;background:#111;color:#eee;text-align:center;padding:20px"><h1>${escapeHtml(prompt)}</h1>${images.map(i => `<img src="${i.url}" style="max-width:100%;border-radius:8px;margin:8px 0">`).join('')}</body></html>`;
        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors, ...security },
        });
      }

      // format === 'json'
      return json({
        object: 'image.generation',
        id: `gen_${requestId.replace(/-/g, '').slice(0, 24)}`,
        created: Math.floor(Date.now() / 1000),
        data: images.map(img => ({
          url: img.url,
          width: img.width,
          height: img.height,
          seed: img.seed,
          cropped: crop,
          style: style || 'default',
          ratio: ratio || 'custom',
          upscale,
          enhanced: enhance,
        })),
      }, 200, cors, security);
    }

    return error(404, 'not_found', 'Resource not found', cors, security);
  },
};

// ============================================
// Helpers
// ============================================

function resolveDimensions(ratio, wOverride, hOverride) {
  let w = 1024, h = 1024;
  if (ratio && RATIOS[ratio]) {
    [w, h] = RATIOS[ratio];
  }
  if (wOverride) w = wOverride;
  if (hOverride) h = hOverride;
  return { width: w, height: h };
}

function validateStyle(value) {
  if (!value) return '';
  const s = String(value).toLowerCase();
  return STYLES[s] ? s : null;
}

function validateRatio(value) {
  if (!value) return '';
  const r = String(value);
  return RATIOS[r] ? r : null;
}

function buildImageUrl(prompt, width, height, style, negative, enhance, crop, upscale, seed) {
  let finalPrompt = prompt;
  let model = 'flux';

  if (style && STYLES[style]) {
    finalPrompt = STYLES[style].prefix + prompt;
    model = STYLES[style].model;
  }

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: 'true',
    seed: String(seed || Math.floor(Math.random() * 1e9)),
  });

  if (enhance) params.set('enhance', 'true');
  if (negative) params.set('negative', negative);

  const base = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}`;
  let raw = `${base}?${params}`;

  const croppedHeight = crop ? Math.floor(height * 0.94) : height;
  const upW = Math.min(width * upscale, 4096);
  const upH = Math.min(croppedHeight * upscale, 4096);

  if (crop || upscale > 1) {
    return `https://wsrv.nl/?url=${encodeURIComponent(raw)}&w=${upW}&h=${upH}&fit=cover&a=top`;
  }
  return raw;
}

function clampInt(v, min, max, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = parseInt(v);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(body, status, cors, security) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors,
      ...security,
    },
  });
}

function error(status, type, message, cors, security) {
  return json({ error: { type, message, status } }, status, cors, security);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---------- Signed tokens ----------

async function encodeToken(payload, secret) {
  const data = JSON.stringify(payload);
  const b64 = base64UrlEncode(new TextEncoder().encode(data));
  const sig = await hmacSign(secret, b64);
  return `${b64}.${sig}`;
}

async function decodeToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = await hmacSign(secret, b64);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const bytes = base64UrlDecode(b64);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

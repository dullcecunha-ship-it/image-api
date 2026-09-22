// ============================================================
// KabirX Image Generation API
// Version: 2.4.0
// ============================================================

const SERVICE = {
  name: 'image-api',
  version: '2.4.0',
};

/* =========================================================
   STYLES
========================================================= */

const STYLES = {
  photo:      { model: 'flux-realism', prefix: 'photorealistic, detailed, 85mm lens, natural lighting, ' },
  anime:      { model: 'flux-anime',   prefix: 'anime style, studio ghibli inspired, vibrant colors, ' },
  art:        { model: 'flux',         prefix: 'digital art, concept art, trending on artstation, ' },
  '3d':       { model: 'flux-3d',      prefix: '3D render, octane render, unreal engine, cinematic lighting, ' },
  dark:       { model: 'any-dark',     prefix: 'dark moody atmosphere, dramatic shadows, ' },
  fast:       { model: 'turbo',        prefix: '' },
  cinem:      { model: 'flux',         prefix: 'cinematic shot, anamorphic lens, film grain, 35mm, ' },
  paint:      { model: 'flux',         prefix: 'oil painting, impressionist style, thick brush strokes, ' },
  sketch:     { model: 'flux',         prefix: 'pencil sketch, hand-drawn, cross-hatching, graphite, ' },
  fantasy:    { model: 'flux',         prefix: 'epic fantasy art, magical atmosphere, detailed environment, ' },
  cyberpunk:  { model: 'flux',         prefix: 'cyberpunk, neon lights, futuristic city, cinematic atmosphere, ' },
  portrait:   { model: 'flux-realism', prefix: 'professional portrait photography, realistic skin, studio lighting, ' },
  product:    { model: 'flux',         prefix: 'professional product photography, clean composition, studio lighting, ' },
  cinematic:  { model: 'flux',         prefix: 'cinematic photography, dramatic composition, volumetric lighting, ' },
  watercolor: { model: 'flux',         prefix: 'watercolor painting, soft washes, artistic paper texture, ' },
  vintage:    { model: 'flux',         prefix: 'vintage photography, nostalgic atmosphere, film grain, ' },
  realistic:  { model: 'flux-realism', prefix: 'highly realistic photography, natural details, realistic lighting, ' },
};

/* =========================================================
   RATIOS
========================================================= */

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

/* =========================================================
   HEADERS
========================================================= */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Accept',
  'Access-Control-Max-Age': '86400',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function headers(extra = {}) {
  return { ...CORS_HEADERS, ...SECURITY_HEADERS, ...extra };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: headers({ 'Content-Type': 'application/json; charset=utf-8', ...extra }),
  });
}

function errorResponse(message, status = 400, code = 'BAD_REQUEST') {
  return json({ success: false, error: { code, message } }, status);
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/* =========================================================
   CONSTANT-TIME COMPARISON
========================================================= */

function timingSafeEqual(a, b) {
  a = String(a);
  b = String(b);
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let result = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i++) {
    result |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return result === 0;
}

/* =========================================================
   BASE64URL
========================================================= */

function base64UrlEncode(value) {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);

  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes) {
  const encoded = base64UrlEncode(bytes);
  return encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
}

/* =========================================================
   HMAC SIGNING
========================================================= */

async function hmacSign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

async function createSignedToken(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSign(body, secret);
  return `${body}.${signature}`;
}

async function verifySignedToken(token, secret) {
  if (typeof token !== 'string' || token.length > 12000) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = await hmacSign(body, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    if (payload.exp && Number(payload.exp) < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/* =========================================================
   AUTH
========================================================= */

function getBearerToken(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

function getApiKey(request, url) {
  const bearer = getBearerToken(request);
  if (bearer) return bearer;

  const headerKey = request.headers.get('X-API-Key');
  if (headerKey) return headerKey.trim();

  const queryKey = url.searchParams.get('key');
  if (queryKey) return queryKey.trim();

  return null;
}

function isMasterKey(request, env, url) {
  const supplied = getApiKey(request, url);
  if (!supplied || !env.MASTER_API_KEY) return false;
  return timingSafeEqual(supplied, env.MASTER_API_KEY);
}

/* =========================================================
   IMAGE PARAMETERS
========================================================= */

function requestAccept(request) {
  return request.headers.get('Accept') || '';
}

function parsePositiveInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return undefined;
  return number;
}

function parseImageParams(request, url, body = {}) {
  const get = (key) => {
    if (body && typeof body === 'object' && body[key] !== undefined && body[key] !== null) {
      return body[key];
    }
    return url.searchParams.get(key);
  };

  const promptValue = get('prompt');
  const prompt = String(promptValue ?? '').trim();
  if (!prompt) throw new Error('Prompt is required');

  const ratioValue = get('ratio');
  const ratio =
    ratioValue === undefined || ratioValue === null || ratioValue === ''
      ? '1:1'
      : String(ratioValue);

  let width = parsePositiveInteger(get('width'));
  let height = parsePositiveInteger(get('height'));

  if (width === undefined || height === undefined) {
    if (!RATIOS[ratio]) throw new Error(`Invalid ratio: ${ratio}`);
    [width, height] = RATIOS[ratio];
  }

  width = clamp(width, 256, 1536);
  height = clamp(height, 256, 1536);

  const nValue = parsePositiveInteger(get('n'));
  const n = clamp(nValue === undefined ? 1 : nValue, 1, 4);

  const upscaleValue = parsePositiveInteger(get('upscale'));
  const upscale = clamp(upscaleValue === undefined ? 1 : upscaleValue, 1, 4);

  const enhance = toBoolean(get('enhance'), false);
  const crop = toBoolean(get('crop'), false);

  const styleValue = get('style');
  const style =
    styleValue !== undefined && styleValue !== null && String(styleValue).trim() !== ''
      ? String(styleValue).trim().toLowerCase()
      : undefined;

  if (style && !Object.prototype.hasOwnProperty.call(STYLES, style)) {
    throw new Error(`Unknown style: ${style}`);
  }

  const negativeValue = get('negative');
  const negative =
    negativeValue !== undefined && negativeValue !== null && String(negativeValue).trim() !== ''
      ? String(negativeValue).slice(0, 2000)
      : undefined;

  const seedValue = get('seed');
  let seed;
  if (seedValue !== undefined && seedValue !== null && String(seedValue).trim() !== '') {
    seed = Number(seedValue);
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new Error('Seed must be a non-negative safe integer');
    }
  }

  const formatValue = get('format');
  let format;
  if (formatValue !== undefined && formatValue !== null && String(formatValue).trim() !== '') {
    format = String(formatValue).trim().toLowerCase();
  } else {
    const accept = requestAccept(request);
    format = accept.toLowerCase().includes('application/json') ? 'json' : 'raw';
  }

  const supportedFormats = ['json', 'raw', 'base64', 'markdown', 'html', 'redirect'];
  if (!supportedFormats.includes(format)) {
    throw new Error(`Unsupported format: ${format}`);
  }

  return {
    prompt: prompt.slice(0, 2000),
    negative,
    style,
    ratio,
    width,
    height,
    n,
    enhance,
    crop,
    upscale,
    seed,
    format,
  };
}

/* =========================================================
   POLLINATIONS URL (INTERNAL)
========================================================= */

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
    seed: String(seed ?? Math.floor(Math.random() * 1e9)),
  });

  if (enhance) params.set('enhance', 'true');
  if (negative) params.set('negative', negative);

  const safePrompt = encodeURIComponent(finalPrompt).replace(/%20/g, '+');
  const raw = `https://image.pollinations.ai/prompt/${safePrompt}?${params.toString()}`;

  if (!crop && upscale === 1) return raw;

  const croppedHeight = crop ? Math.floor(height * 0.94) : height;
  const upW = Math.min(width * upscale, 4096);
  const upH = Math.min(croppedHeight * upscale, 4096);

  return `https://wsrv.nl/?url=${encodeURIComponent(raw)}&w=${upW}&h=${upH}&fit=cover&a=top`;
}

/* =========================================================
   D1 LOGGING
========================================================= */

async function saveGeneration(env, data) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO generations (
         id, user_id, prompt, negative, style, width, height, n,
         enhance, upscale, seed, status, result_data, error_message,
         duration_ms, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        data.id,
        data.user_id || null,
        data.prompt,
        data.negative || null,
        data.style || null,
        data.width,
        data.height,
        data.n,
        data.enhance ? 1 : 0,
        data.upscale,
        data.seed ?? null,
        data.status,
        data.result_data || null,
        data.error_message || null,
        data.duration_ms ?? null,
        now(),
      )
      .run();
  } catch {
    // DB logging must never break image generation.
  }
}

async function saveUsage(env, generationId, units = 1) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO usage (id, generation_id, units, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(uuid(), generationId, units, now())
      .run();
  } catch {
    // Non-blocking.
  }
}

/* =========================================================
   SIGNED PUBLIC IMAGE URL
========================================================= */

async function createImageToken(params, env, seedOverride) {
  const secret = env.SIGNING_SECRET || env.MASTER_API_KEY;
  if (!secret) throw new Error('Image signing is not configured');

  const seed =
    seedOverride ??
    params.seed ??
    Math.floor(Math.random() * 1e9);

  const payload = {
    v: 1,
    prompt: params.prompt,
    negative: params.negative || null,
    style: params.style || null,
    ratio: params.ratio,
    width: params.width,
    height: params.height,
    upscale: params.upscale,
    enhance: params.enhance,
    crop: params.crop,
    seed,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };

  return { token: await createSignedToken(payload, secret), seed };
}

function publicImageUrl(request, token) {
  const url = new URL(request.url);
  return `${url.origin}/i/${encodeURIComponent(token)}`;
}

/* =========================================================
   IMAGE PROXY
========================================================= */

async function proxyImageFromToken(request, env, token) {
  const secret = env.SIGNING_SECRET || env.MASTER_API_KEY;
  if (!secret) {
    return errorResponse('Image service is not configured', 500, 'SIGNING_NOT_CONFIGURED');
  }

  const payload = await verifySignedToken(token, secret);
  if (!payload) {
    return errorResponse('Invalid or expired image URL', 401, 'INVALID_IMAGE_TOKEN');
  }

  if (
    typeof payload.prompt !== 'string' ||
    !Number.isInteger(payload.width) ||
    !Number.isInteger(payload.height) ||
    payload.width < 256 ||
    payload.width > 1536 ||
    payload.height < 256 ||
    payload.height > 1536 ||
    !Number.isInteger(payload.upscale) ||
    payload.upscale < 1 ||
    payload.upscale > 4 ||
    typeof payload.enhance !== 'boolean' ||
    typeof payload.crop !== 'boolean'
  ) {
    return errorResponse('Invalid image token payload', 401, 'INVALID_IMAGE_TOKEN');
  }

  try {
    const upstreamUrl = buildImageUrl(
      payload.prompt,
      payload.width,
      payload.height,
      payload.style,
      payload.negative,
      payload.enhance,
      payload.crop,
      payload.upscale,
      payload.seed,
    );

    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
      cf: { cacheEverything: true },
    });

    if (!upstream.ok) {
      return errorResponse('Image generation failed', 502, 'UPSTREAM_IMAGE_ERROR');
    }

    const contentType = upstream.headers.get('Content-Type') || 'image/jpeg';

    return new Response(upstream.body, {
      status: 200,
      headers: headers({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      }),
    });
  } catch {
    return errorResponse('Unable to retrieve image', 502, 'IMAGE_FETCH_FAILED');
  }
}

/* =========================================================
   GENERATE IMAGE — now honors n
========================================================= */

async function handleImage(request, env, params) {
  const started = performance.now();
  const id = uuid();

  try {
    // Build one token per requested image, each with a distinct seed.
    const tokenResults = [];
    for (let i = 0; i < params.n; i++) {
      const seedForThis =
        params.seed !== undefined ? params.seed + i : undefined;
      tokenResults.push(await createImageToken(params, env, seedForThis));
    }

    const images = tokenResults.map(({ token, seed }) => ({
      url: publicImageUrl(request, token),
      seed,
      width: params.width,
      height: params.height,
      style: params.style || null,
      ratio: params.ratio,
      upscale: params.upscale,
      enhanced: params.enhance,
      cropped: params.crop,
    }));

    const firstUrl = images[0].url;

    const duration = Math.round(performance.now() - started);

    await saveGeneration(env, {
      id,
      prompt: params.prompt,
      negative: params.negative,
      style: params.style,
      width: params.width,
      height: params.height,
      n: params.n,
      enhance: params.enhance,
      upscale: params.upscale,
      seed: params.seed,
      status: 'completed',
      result_data: JSON.stringify({ images }),
      duration_ms: duration,
    });

    await saveUsage(env, id, params.n);

    // ---------- raw / redirect ----------
    if (params.format === 'raw' || params.format === 'redirect') {
      return Response.redirect(firstUrl, 302);
    }

    // ---------- json ----------
    if (params.format === 'json') {
      return json({
        success: true,
        id,
        object: 'image.generation',
        created: Math.floor(Date.now() / 1000),
        data: images,
        urls: images.map((i) => i.url),
        width: params.width,
        height: params.height,
        n: params.n,
        style: params.style || null,
      });
    }

    // ---------- markdown ----------
    if (params.format === 'markdown') {
      const markdown = images
        .map((img) => `![${escapeMarkdown(params.prompt)}](${img.url})`)
        .join('\n\n');
      return json({
        success: true,
        id,
        markdown,
        urls: images.map((i) => i.url),
        width: params.width,
        height: params.height,
        n: params.n,
      });
    }

    // ---------- html ----------
    if (params.format === 'html') {
      const alt = escapeHtml(params.prompt);
      const imgs = images
        .map((img) => `<img src="${escapeHtml(img.url)}" alt="${alt}">`)
        .join('\n');
      const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KabirX Image</title>
<style>
html,body{margin:0;min-height:100%;background:#111}
body{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center}
img{max-width:100%;max-height:100vh;object-fit:contain}
</style>
</head>
<body>
${imgs}
</body>
</html>`;
      return new Response(html, {
        status: 200,
        headers: headers({ 'Content-Type': 'text/html; charset=utf-8' }),
      });
    }

    // ---------- base64 ----------
    if (params.format === 'base64') {
      const results = [];
      for (const img of images) {
        const response = await fetch(img.url, {
          headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
        });
        if (!response.ok) {
          return errorResponse(
            'Unable to retrieve generated image',
            502,
            'IMAGE_FETCH_FAILED',
          );
        }
        const buffer = await response.arrayBuffer();
        const base64 = bytesToBase64(new Uint8Array(buffer));
        results.push({
          url: img.url,
          seed: img.seed,
          mime_type: response.headers.get('Content-Type') || 'image/jpeg',
          base64,
        });
      }
      return json({
        success: true,
        id,
        width: params.width,
        height: params.height,
        n: params.n,
        data: results,
      });
    }

    return errorResponse('Unsupported format', 400, 'UNSUPPORTED_FORMAT');
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : 'Image generation failed',
      502,
      'IMAGE_GENERATION_FAILED',
    );
  }
}

/* =========================================================
   ESCAPING
========================================================= */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdown(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/* =========================================================
   SIGN ENDPOINT
========================================================= */

async function handleSign(request, env, url) {
  if (!isMasterKey(request, env, url)) {
    return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  }

  try {
    const params = parseImageParams(request, url, {});
    const { token, seed } = await createImageToken(params, env);

    return json({
      success: true,
      token,
      url: publicImageUrl(request, token),
      seed,
      expires_in: 3600,
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Invalid parameters',
      400,
      'INVALID_PARAMETERS',
    );
  }
}

/* =========================================================
   STYLES / RATIOS
========================================================= */

function handleStyles() {
  return json({
    success: true,
    styles: Object.entries(STYLES).map(([id]) => ({ id, name: id })),
  });
}

function handleRatios() {
  return json({
    success: true,
    ratios: Object.entries(RATIOS).map(([id, [w, h]]) => ({
      id,
      width: w,
      height: h,
    })),
  });
}

/* =========================================================
   GENERATIONS
========================================================= */

async function handleGenerations(request, env, url) {
  if (!isMasterKey(request, env, url)) {
    return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  }
  if (!env.DB) {
    return errorResponse('Database unavailable', 503, 'DATABASE_UNAVAILABLE');
  }

  try {
    const requestedLimit = Number(url.searchParams.get('limit') || 20);
    if (!Number.isFinite(requestedLimit)) {
      return errorResponse('Invalid limit', 400, 'INVALID_PARAMETERS');
    }
    const limit = clamp(Math.floor(requestedLimit), 1, 100);

    const result = await env.DB.prepare(
      `SELECT id, prompt, negative, style, width, height, n,
              enhance, upscale, seed, status, result_data, error_message,
              duration_ms, created_at
       FROM generations
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all();

    return json({
      success: true,
      generations: result.results || [],
    });
  } catch {
    return errorResponse('Unable to retrieve generations', 500, 'DATABASE_ERROR');
  }
}

async function handleGeneration(request, env, url, id) {
  if (!isMasterKey(request, env, url)) {
    return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  }
  if (!env.DB) {
    return errorResponse('Database unavailable', 503, 'DATABASE_UNAVAILABLE');
  }
  if (!id || id.length > 200) {
    return errorResponse('Invalid generation ID', 400, 'INVALID_PARAMETERS');
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, prompt, negative, style, width, height, n,
              enhance, upscale, seed, status, result_data, error_message,
              duration_ms, created_at
       FROM generations
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(id)
      .first();

    if (!result) {
      return errorResponse('Generation not found', 404, 'NOT_FOUND');
    }

    return json({ success: true, generation: result });
  } catch {
    return errorResponse('Unable to retrieve generation', 500, 'DATABASE_ERROR');
  }
}

/* =========================================================
   HEALTH / ROOT
========================================================= */

async function handleHealth(env) {
  let database = false;
  if (env.DB) {
    try {
      await env.DB.prepare('SELECT 1').first();
      database = true;
    } catch {
      database = false;
    }
  }

  return json({
    success: true,
    service: SERVICE.name,
    version: SERVICE.version,
    status: database ? 'healthy' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  });
}

function handleRoot() {
  return json({
    success: true,
    service: SERVICE.name,
    version: SERVICE.version,
    status: 'online',
    endpoints: {
      health: '/v1/health',
      styles: '/v1/styles',
      ratios: '/v1/ratios',
      image: '/v1/image',
      sign: '/v1/sign',
      generations: '/v1/generations',
    },
  });
}

/* =========================================================
   ROUTER
========================================================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: headers() });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/') {
        return handleRoot();
      }

      if (request.method === 'GET' && url.pathname === '/v1/health') {
        return handleHealth(env);
      }

      if (request.method === 'GET' && url.pathname === '/v1/styles') {
        return handleStyles();
      }

      if (request.method === 'GET' && url.pathname === '/v1/ratios') {
        return handleRatios();
      }

      if (request.method === 'GET' && url.pathname === '/v1/sign') {
        return handleSign(request, env, url);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/i/')) {
        const token = decodeURIComponent(url.pathname.slice(3));
        return proxyImageFromToken(request, env, token);
      }

      if (request.method === 'GET' && url.pathname === '/v1/generations') {
        return handleGenerations(request, env, url);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/v1/generations/')) {
        const id = decodeURIComponent(url.pathname.slice('/v1/generations/'.length));
        return handleGeneration(request, env, url, id);
      }

      if (
        (request.method === 'GET' || request.method === 'POST') &&
        url.pathname === '/v1/image'
      ) {
        let body = {};

        if (request.method === 'POST') {
          const contentType = request.headers.get('Content-Type') || '';
          if (contentType.toLowerCase().includes('application/json')) {
            try {
              body = await request.json();
            } catch {
              return errorResponse('Invalid JSON body', 400, 'INVALID_JSON');
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
              return errorResponse('JSON body must be an object', 400, 'INVALID_JSON');
            }
          }
        }

        if (!isMasterKey(request, env, url)) {
          return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
        }

        try {
          const params = parseImageParams(request, url, body);
          return handleImage(request, env, params);
        } catch (error) {
          return errorResponse(
            error instanceof Error ? error.message : 'Invalid parameters',
            400,
            'INVALID_PARAMETERS',
          );
        }
      }

      return errorResponse('Not found', 404, 'NOT_FOUND');
    } catch {
      return errorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    }
  },
};

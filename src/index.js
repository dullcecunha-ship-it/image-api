const SERVICE = {
  name: 'image-api',
  version: '2.3.9',
};

const DEFAULT_RATIO = '1:1';
const SIGNED_TOKEN_VERSION = 1;
const TOKEN_MAX_CHARS = 40000;
const PROMPT_MAX_BYTES = 2000;
const NEGATIVE_MAX_BYTES = 2000;
const MAX_SEED = Number.MAX_SAFE_INTEGER - 4;
const MAX_BODY_BYTES = 64 * 1024;

/* =========================================================
   STYLES / RATIOS
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

function uuid() { return crypto.randomUUID(); }
function now() { return Date.now(); }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

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

function asString(v, name) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new Error(`Parameter '${name}' must be a string`);
}

function sliceUtf8(str, maxBytes) {
  const enc = new TextEncoder();
  if (str.length <= maxBytes && enc.encode(str).length <= maxBytes) return str;

  let out = '';
  let used = 0;
  for (const ch of str) {
    const n = enc.encode(ch).length;
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}

/* =========================================================
   NUMERIC HELPERS
========================================================= */

function numParam(get, key) {
  const v = get(key);
  if (v === undefined || v === null || v === '') return NaN;
  return Number(v);
}

function intParam(get, key, fallback, min, max) {
  const raw = get(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.floor(n), min, max);
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
  const chunkSize = 0x4000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
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
  let binary = '';
  const chunkSize = 0x4000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/* =========================================================
   HMAC
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
  if (typeof token !== 'string') return null;
  if (token.length > TOKEN_MAX_CHARS) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = await hmacSign(body, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (payload.v !== SIGNED_TOKEN_VERSION) return null;

    const exp = Number(payload.exp);
    if (!Number.isFinite(exp)) return null;
    if (exp < Math.floor(Date.now() / 1000)) return null;

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
  return authorization.slice(7).trim() || null;
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
   PARAM PARSING
========================================================= */

function parseImageParams(url, body = {}, accept = '', method = 'GET', opts = {}) {
  const get = (key) => {
    if (body && body[key] !== undefined && body[key] !== null) return body[key];
    return url.searchParams.get(key);
  };

  const promptRaw = asString(get('prompt'), 'prompt');
  if (!promptRaw.trim()) throw new Error('Prompt is required');

  const ratio = asString(get('ratio'), 'ratio') || DEFAULT_RATIO;
  if (!RATIOS[ratio]) throw new Error(`Invalid ratio: ${ratio}`);

  const rawW = numParam(get, 'width');
  const rawH = numParam(get, 'height');
  const haveW = Number.isFinite(rawW);
  const haveH = Number.isFinite(rawH);
  const [ratioW, ratioH] = RATIOS[ratio];

  let width, height;
  if (haveW && haveH) { width = rawW; height = rawH; }
  else if (haveW && !haveH) { width = rawW; height = Math.round(rawW * (ratioH / ratioW)); }
  else if (!haveW && haveH) { height = rawH; width = Math.round(rawH * (ratioW / ratioH)); }
  else { width = ratioW; height = ratioH; }

  width = clamp(Math.floor(width), 256, 1536);
  height = clamp(Math.floor(height), 256, 1536);

  const n = intParam(get, 'n', 1, 1, 4);
  const upscale = intParam(get, 'upscale', 1, 1, 4);
  const enhance = toBoolean(get('enhance'), false);
  const crop = toBoolean(get('crop'), false);

  const styleStr = asString(get('style'), 'style');
  const style = styleStr ? styleStr.toLowerCase() : undefined;
  if (style && !STYLES[style]) throw new Error(`Unknown style: ${style}`);

  const negativeRaw = asString(get('negative'), 'negative');
  const negative = negativeRaw ? sliceUtf8(negativeRaw, NEGATIVE_MAX_BYTES) : undefined;

  const seedValue = get('seed');
  let seed;
  if (seedValue !== null && seedValue !== undefined && seedValue !== '') {
    seed = Number(seedValue);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
      throw new Error(`Seed must be an integer in [0, ${MAX_SEED}]`);
    }
  }

  let format;
  if (!opts.skipFormat) {
    const formatStr = asString(get('format'), 'format');
    if (formatStr) format = formatStr.toLowerCase();
    else if (method === 'POST') format = 'json';
    else format = accept.toLowerCase().includes('application/json') ? 'json' : 'raw';

    const supportedFormats = ['json', 'raw', 'base64', 'markdown', 'html', 'redirect'];
    if (!supportedFormats.includes(format)) {
      throw new Error(`Unsupported format: ${format}`);
    }
  }

  return {
    prompt: sliceUtf8(promptRaw, PROMPT_MAX_BYTES),
    negative, style, ratio, width, height, n, enhance, crop, upscale, seed, format,
  };
}

/* =========================================================
   UPSTREAM
========================================================= */

function buildImageUrl(prompt, width, height, style, negative, enhance, crop, upscale, seed) {
  let finalPrompt = prompt;
  let model = 'flux';

  if (style && STYLES[style]) {
    finalPrompt = STYLES[style].prefix + prompt;
    model = STYLES[style].model;
  }

  const params = new URLSearchParams({
    width: String(width), height: String(height), model,
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

async function fetchUpstream(payload) {
  const upstreamUrl = buildImageUrl(
    payload.prompt, payload.width, payload.height, payload.style,
    payload.negative, payload.enhance, payload.crop, payload.upscale, payload.seed,
  );

  return fetch(upstreamUrl, {
    method: 'GET',
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
    cf: { cacheEverything: true },
  });
}

function safeImageContentType(value) {
  const ct = String(value || '');
  if (/^image\//i.test(ct) && !/svg/i.test(ct)) return ct;
  return 'image/jpeg';
}

/* =========================================================
   DATABASE
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
        data.id, data.user_id || null, data.prompt, data.negative || null,
        data.style || null, data.width, data.height, data.n,
        data.enhance ? 1 : 0, data.upscale, data.seed ?? null,
        data.status, data.result_data || null, data.error_message || null,
        data.duration_ms ?? null, data.created_at ?? now(),
      )
      .run();
  } catch {
    // Never break generation.
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
   SIGNED TOKEN
========================================================= */

async function createImageTokenWithPayload(params, env, seedOverride) {
  const secret = env.SIGNING_SECRET || env.MASTER_API_KEY;
  if (!secret) throw new Error('Image signing is not configured');

  let seed;
  if (seedOverride !== undefined && seedOverride !== null) seed = Number(seedOverride);
  else if (params.seed !== undefined) seed = params.seed;
  else seed = Math.floor(Math.random() * 1e9);

  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
    seed = Math.floor(Math.random() * 1e9);
  }

  const payload = {
    v: SIGNED_TOKEN_VERSION,
    prompt: params.prompt,
    negative: params.negative || null,
    style: params.style || null,
    ratio: params.ratio,
    width: params.width, height: params.height,
    upscale: params.upscale,
    enhance: params.enhance, crop: params.crop,
    seed,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };

  const token = await createSignedToken(payload, secret);
  return { token, payload };
}

function publicImageUrl(request, env, token) {
  const base = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  return `${base}/i/${encodeURIComponent(token)}`;
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

  try {
    const upstream = await fetchUpstream(payload);
    if (!upstream.ok) {
      return errorResponse('Image generation failed', 502, 'UPSTREAM_IMAGE_ERROR');
    }

    return new Response(upstream.body, {
      status: 200,
      headers: headers({
        'Content-Type': safeImageContentType(upstream.headers.get('Content-Type')),
        'Cache-Control': 'public, max-age=3600',
      }),
    });
  } catch {
    return errorResponse('Unable to retrieve image', 502, 'IMAGE_FETCH_FAILED');
  }
}

/* =========================================================
   RESPONSE BUILDER
   Each branch returns { response, status, error }.
   id is threaded from handleImage so the response id matches
   the generations row.
========================================================= */

async function resolveImageResponse(id, params, images, tokenResults, started) {
  if (params.format === 'raw' || params.format === 'redirect') {
    const location = images[0]?.url;
    if (!location) {
      return {
        response: errorResponse('No images produced', 500, 'NO_IMAGES'),
        status: 'failed',
        error: 'no image URL',
      };
    }
    return {
      response: new Response(null, {
        status: 302,
        headers: headers({ Location: location }),
      }),
      status: 'completed',
      error: null,
    };
  }

  if (params.format === 'json') {
    const duration = Math.round(performance.now() - started);
    return {
      response: json({
        success: true,
        id,
        object: 'image.generation',
        created: Math.floor(Date.now() / 1000),
        data: images,
        urls: images.map((i) => i.url),
        width: params.width, height: params.height, n: params.n,
        style: params.style || null,
        duration_ms: duration,
      }),
      status: 'completed',
      error: null,
    };
  }

  if (params.format === 'markdown') {
    const markdown = images
      .map((img) => `![${escapeMarkdown(params.prompt)}](${img.url})`)
      .join('\n\n');
    return {
      response: json({
        success: true, id, markdown,
        urls: images.map((i) => i.url),
        width: params.width, height: params.height, n: params.n,
      }),
      status: 'completed',
      error: null,
    };
  }

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
<title>KabirX — Generated Image</title>
<style>
  html,body { margin: 0; padding: 16px; background: #0b0f19; color: #e6edf7; font-family: system-ui, -apple-system, sans-serif; }
  body { display: flex; flex-direction: column; align-items: center; gap: 12px; min-height: 100vh; box-sizing: border-box; }
  img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); }
</style>
</head>
<body>
${imgs}
</body>
</html>`;

    return {
      response: new Response(html, {
        status: 200,
        headers: headers({ 'Content-Type': 'text/html; charset=utf-8' }),
      }),
      status: 'completed',
      error: null,
    };
  }

  if (params.format === 'base64') {
    let responses;
    try {
      responses = await Promise.all(
        tokenResults.map(({ payload }) => fetchUpstream(payload)),
      );
    } catch (err) {
      return {
        response: errorResponse('Upstream image fetch failed', 502, 'UPSTREAM_IMAGE_ERROR'),
        status: 'failed',
        error: err instanceof Error ? err.message : 'fetch failed',
      };
    }

    const bad = responses.find((r) => !r.ok);
    if (bad) {
      return {
        response: errorResponse('Upstream image fetch failed', 502, 'UPSTREAM_IMAGE_ERROR'),
        status: 'failed',
        error: `Upstream returned ${bad.status}`,
      };
    }

    try {
      const results = await Promise.all(
        responses.map(async (r, i) => ({
          index: i,
          url: images[i].url,
          mime_type: safeImageContentType(r.headers.get('Content-Type')),
          base64: bytesToBase64(new Uint8Array(await r.arrayBuffer())),
        })),
      );
      const duration = Math.round(performance.now() - started);
      return {
        response: json({
          success: true, id,
          width: params.width, height: params.height, n: params.n,
          duration_ms: duration,
          data: results,
        }),
        status: 'completed',
        error: null,
      };
    } catch (err) {
      return {
        response: errorResponse('Unable to encode generated image', 502, 'BASE64_ENCODING_FAILED'),
        status: 'failed',
        error: err instanceof Error ? err.message : 'encode failed',
      };
    }
  }

  return {
    response: errorResponse('Unsupported format', 400, 'UNSUPPORTED_FORMAT'),
    status: 'failed',
    error: `Unsupported format: ${params.format}`,
  };
}

/* =========================================================
   GENERATE IMAGE
   Single outcome → single saveGeneration call.
========================================================= */

async function handleImage(request, env, params) {
  const started = performance.now();
  const id = uuid();

  const tokenResults = await Promise.all(
    Array.from({ length: params.n }, (_, i) =>
      createImageTokenWithPayload(
        params, env,
        params.seed !== undefined ? params.seed + i : undefined,
      ),
    ),
  );

  const images = tokenResults.map(({ token, payload }, i) => ({
    url: publicImageUrl(request, env, token),
    index: i,
    width: payload.width,
    height: payload.height,
    style: payload.style || null,
    ratio: payload.ratio,
    upscale: payload.upscale,
    enhanced: payload.enhance,
    cropped: payload.crop,
    seed: payload.seed,
  }));

  // Record zero-image failures via the same outcome path so the
  // generations row is written exactly once regardless of branch.
  const outcome = images.length === 0
    ? {
        response: errorResponse('No images produced', 500, 'NO_IMAGES'),
        status: 'failed',
        error: 'No images produced',
      }
    : await resolveImageResponse(id, params, images, tokenResults, started);

  const finalDuration = Math.round(performance.now() - started);

  await saveGeneration(env, {
    id,
    prompt: params.prompt,
    negative: params.negative,
    style: params.style,
    width: params.width, height: params.height,
    n: params.n,
    enhance: params.enhance, upscale: params.upscale,
    seed: params.seed,
    status: outcome.status,
    result_data: outcome.status === 'completed' ? JSON.stringify({ images }) : null,
    error_message: outcome.error,
    duration_ms: finalDuration,
  });

  if (outcome.status === 'completed') {
    await saveUsage(env, id, params.n);
  }

  return outcome.response;
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
    .replace(/`/g, '\\`')
    .replace(/!/g, '\\!')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[+\->|~*_#]/g, (m) => '\\' + m);
}

/* =========================================================
   SIGN / STYLES / RATIOS / GENERATIONS
========================================================= */

async function handleSign(request, env, url) {
  if (!isMasterKey(request, env, url)) {
    return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  }

  try {
    const accept = request.headers.get('Accept') || '';
    const params = parseImageParams(url, {}, accept, 'GET', { skipFormat: true });
    const { token } = await createImageTokenWithPayload(params, env);

    return json({
      success: true,
      token,
      url: publicImageUrl(request, env, token),
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

function handleStyles() {
  return json({ success: true, styles: Object.keys(STYLES) });
}

function handleRatios() {
  return json({
    success: true,
    ratios: Object.entries(RATIOS).map(([id, dimensions]) => ({
      id,
      width: dimensions[0],
      height: dimensions[1],
    })),
  });
}

function parseResultData(row) {
  if (!row || !row.result_data) return row;
  try {
    return { ...row, result_data: JSON.parse(row.result_data) };
  } catch {
    return row;
  }
}

async function handleGenerations(request, env, url) {
  if (!isMasterKey(request, env, url)) {
    return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  }
  if (!env.DB) {
    return errorResponse('Database unavailable', 503, 'DATABASE_UNAVAILABLE');
  }

  try {
    const limitN = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(limitN) ? clamp(Math.floor(limitN), 1, 100) : 20;

    const offsetN = Number(url.searchParams.get('offset'));
    const offset = Number.isFinite(offsetN) ? clamp(Math.floor(offsetN), 0, 100000) : 0;

    // COUNT(*) is skipped when ?with_total=false to avoid a second
    // D1 round-trip on large tables.
    const withTotal = url.searchParams.get('with_total') !== 'false';

    const result = await env.DB.prepare(
      `SELECT
        id, prompt, negative, style, width, height, n,
        enhance, upscale, seed, status, result_data, error_message,
        duration_ms, created_at
      FROM generations
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all();

    let total = null;
    if (withTotal) {
      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) AS c FROM generations',
      ).first();
      total = countRow && Number.isFinite(Number(countRow.c))
        ? Number(countRow.c)
        : null;
    }

    const rows = (result.results || []).map(parseResultData);

    return json({ success: true, limit, offset, total, generations: rows });
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

  try {
    const result = await env.DB.prepare(
      `SELECT
        id, prompt, negative, style, width, height, n,
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

    return json({ success: true, generation: parseResultData(result) });
  } catch {
    return errorResponse('Unable to retrieve generation', 500, 'DATABASE_ERROR');
  }
}

/* =========================================================
   HEALTH / ROOT
========================================================= */

// DB probe is opt-in via ?deep=true. When D1 is not bound at all,
// deep returns status "not_configured" and stays 200 — DB is
// optional throughout this Worker.
async function handleHealth(env, url) {
  const deep = url.searchParams.get('deep') === 'true';
  let database = null;
  let ok = true;

  if (deep) {
    if (!env.DB) {
      database = 'not_configured';
    } else {
      try {
        await env.DB.prepare('SELECT 1').first();
        database = true;
      } catch {
        database = false;
        ok = false;
      }
    }
  }

  return json({
    success: ok,
    service: SERVICE.name,
    version: SERVICE.version,
    status: ok ? 'healthy' : 'degraded',
    database,
    deep,
    timestamp: new Date().toISOString(),
  }, ok ? 200 : 503);
}

function handleRoot() {
  return json({
    success: true,
    service: SERVICE.name,
    version: SERVICE.version,
    status: 'online',
    limits: {
      prompt_bytes: PROMPT_MAX_BYTES,
      negative_bytes: NEGATIVE_MAX_BYTES,
      body_bytes: MAX_BODY_BYTES,
      seed_max: MAX_SEED,
      token_max_chars: TOKEN_MAX_CHARS,
    },
    notes: {
      dimensions: 'If only one of width/height is supplied, the other is derived from ratio.',
      post_default_format: 'json',
      get_default_format: 'raw',
      raw_multi_image: 'format=raw|redirect returns only the first image when n>1',
      result_data: 'result_data is returned as a parsed object, not a JSON string',
      health_deep: 'Add ?deep=true to /v1/health to include a D1 probe. When D1 is not bound, returns "not_configured" and stays 200.',
      generations_total: 'Add ?with_total=false to /v1/generations to skip the COUNT(*) query.',
      empty_post: 'POST with no body and no Content-Type is treated as a query-string call.',
    },
    endpoints: {
      health: '/v1/health',
      styles: '/v1/styles',
      ratios: '/v1/ratios',
      image: '/v1/image',
      image_proxy: '/i/:token',
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

    const accept = request.headers.get('Accept') || '';

    try {
      if (request.method === 'GET' && url.pathname === '/') return handleRoot();
      if (request.method === 'GET' && url.pathname === '/v1/health') return handleHealth(env, url);
      if (request.method === 'GET' && url.pathname === '/v1/styles') return handleStyles();
      if (request.method === 'GET' && url.pathname === '/v1/ratios') return handleRatios();
      if (request.method === 'GET' && url.pathname === '/v1/sign') return handleSign(request, env, url);

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
        // Authenticate before touching the body.
        if (!isMasterKey(request, env, url)) {
          return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
        }

        let body = {};

        if (request.method === 'POST') {
          // Fast reject on header, malformed treated as oversized.
          const lenHeader = request.headers.get('Content-Length');
          if (lenHeader !== null) {
            const len = Number(lenHeader);
            if (!Number.isFinite(len) || len > MAX_BODY_BYTES) {
              return errorResponse('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
            }
          }

          let buf;
          try {
            buf = await request.arrayBuffer();
          } catch {
            return errorResponse('Unable to read request body', 400, 'INVALID_BODY');
          }

          if (buf.byteLength > MAX_BODY_BYTES) {
            return errorResponse('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
          }

          // CT is only required when a body is actually present.
          // Empty POST (no body) falls through as a query-string call.
          if (buf.byteLength > 0) {
            const ct = (request.headers.get('Content-Type') || '').toLowerCase();
            if (!ct || !ct.includes('application/json')) {
              return errorResponse(
                'POST with body requires Content-Type: application/json',
                415,
                'UNSUPPORTED_MEDIA_TYPE',
              );
            }

            let parsed;
            try {
              parsed = JSON.parse(new TextDecoder('utf-8').decode(buf));
            } catch {
              return errorResponse('Invalid JSON body', 400, 'INVALID_JSON');
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              return errorResponse('JSON body must be an object', 400, 'INVALID_JSON');
            }
            body = parsed;
          }
        }

        try {
          const params = parseImageParams(url, body, accept, request.method);
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

// ============================================
// Image Generation API v1.0.0
// Copyright (c) 2026 All rights reserved.
// ============================================

const SERVICE_NAME = 'image-api';
const SERVICE_VERSION = '1.0.0';
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

export default {
  async fetch(request, env) {
    const started = Date.now();
    const requestId = crypto.randomUUID();

    // ---------- CORS + Security headers ----------
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
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, ...security } });
    }

    const url = new URL(request.url);

    // ---------- GET /  (service info) ----------
    if (url.pathname === '/' && request.method === 'GET') {
      return json({
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        status: 'operational',
        documentation: 'https://docs.example.com',
      }, 200, cors, security);
    }

    // ---------- GET /v1/health ----------
    if (url.pathname === '/v1/health' && request.method === 'GET') {
      return json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - started,
      }, 200, cors, security);
    }

    // ---------- GET /v1/version ----------
    if (url.pathname === '/v1/version' && request.method === 'GET') {
      return json({
        version: SERVICE_VERSION,
        api_level: 1,
      }, 200, cors, security);
    }

    // ---------- GET /v1/image ----------
    if (url.pathname === '/v1/image' && request.method === 'GET') {
      return handleGenerate(request, env, url.searchParams, 'key', cors, security, requestId);
    }

    // ---------- POST /v1/image ----------
    if (url.pathname === '/v1/image' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch {
        return error(400, 'invalid_request', 'Request body must be valid JSON', cors, security);
      }
      return handleGenerate(request, env, body, 'header', cors, security, requestId);
    }

    return error(404, 'not_found', 'The requested resource does not exist', cors, security);
  },
};

// ============================================
// Handlers
// ============================================

async function handleGenerate(request, env, source, authMode, cors, security, requestId) {
  const started = Date.now();

  // --- Authentication ---
  let key;
  if (authMode === 'key') {
    key = source.get ? source.get('key') : null;
  } else {
    const auth = request.headers.get('Authorization') || '';
    key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  }

  if (!env.API_KEY || !key) {
    return error(401, 'unauthorized', 'Missing authentication credentials', cors, security);
  }
  if (!timingSafeEqual(key, env.API_KEY)) {
    return error(401, 'unauthorized', 'Invalid authentication credentials', cors, security);
  }

  // --- Input validation ---
  const getParam = (name) => (source.get ? source.get(name) : source[name]);

  const prompt = String(getParam('prompt') || '').trim();
  if (!prompt) {
    return error(400, 'invalid_request', "Parameter 'prompt' is required", cors, security);
  }
  if (prompt.length > 2000) {
    return error(400, 'invalid_request', "Parameter 'prompt' exceeds maximum length of 2000 characters", cors, security);
  }

  const width = clampInt(getParam('width'), 256, 1536, DEFAULT_WIDTH);
  const height = clampInt(getParam('height'), 256, 1536, DEFAULT_HEIGHT);
  const model = sanitizeModel(getParam('model'));
  const crop = getParam('crop') !== 'false' && getParam('crop') !== false;
  const seed = getParam('seed') ? parseInt(getParam('seed')) : Math.floor(Math.random() * 1e9);

  if (width === null) {
    return error(400, 'invalid_request', "Parameter 'width' must be an integer between 256 and 1536", cors, security);
  }
  if (height === null) {
    return error(400, 'invalid_request', "Parameter 'height' must be an integer between 256 and 1536", cors, security);
  }
  if (model === null) {
    return error(400, 'invalid_request', "Parameter 'model' is not supported", cors, security);
  }

  // --- Build internal request ---
  const imageUrl = buildImageUrl(prompt, width, height, model, seed, crop);

  // --- Response ---
  return json({
    object: 'image.generation',
    id: `gen_${requestId.replace(/-/g, '').slice(0, 24)}`,
    created: Math.floor(Date.now() / 1000),
    data: [{
      url: imageUrl,
      width,
      height,
      cropped: crop,
      model,
    }],
    usage: {
      latency_ms: Date.now() - started,
    },
  }, 200, cors, security);
}

// ============================================
// Utilities
// ============================================

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

function error(status, code, message, cors, security) {
  return json({
    error: {
      type: code,
      message,
      status,
    },
  }, status, cors, security);
}

function clampInt(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value);
  if (isNaN(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function sanitizeModel(value) {
  const allowed = ['flux', 'turbo', 'kontext'];
  if (!value) return 'flux';
  const v = String(value).toLowerCase();
  return allowed.includes(v) ? v : null;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function buildImageUrl(prompt, width, height, model, seed, crop) {
  const base = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: 'true',
    seed: String(seed),
  });
  const rawUrl = `${base}?${params.toString()}`;

  if (!crop) return rawUrl;

  const croppedHeight = Math.floor(height * 0.94);
  return `https://wsrv.nl/?url=${encodeURIComponent(rawUrl)}&w=${width}&h=${croppedHeight}&fit=cover&a=top`;
}

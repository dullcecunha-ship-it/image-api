// ============================================================
// KabirX Image Generation API v2.3.0
// Cloudflare Worker + D1 + Pollinations
// ============================================================

const SERVICE = {
  name: "image-api",
  version: "2.3.0",
};

// ============================================================
// CONFIG
// ============================================================

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt/";
const WSRV_BASE = "https://wsrv.nl/";

const STYLES = {
  photo: {
    model: "flux-realism",
    prefix:
      "photorealistic, detailed, 85mm lens, natural lighting, ",
  },

  anime: {
    model: "flux-anime",
    prefix:
      "anime style, vibrant colors, detailed illustration, ",
  },

  art: {
    model: "flux",
    prefix:
      "digital art, concept art, highly detailed, ",
  },

  "3d": {
    model: "flux-3d",
    prefix:
      "3D render, octane render, unreal engine, cinematic lighting, ",
  },

  dark: {
    model: "any-dark",
    prefix:
      "dark moody atmosphere, dramatic shadows, ",
  },

  fast: {
    model: "turbo",
    prefix: "",
  },

  cinem: {
    model: "flux",
    prefix:
      "cinematic shot, anamorphic lens, film grain, 35mm, ",
  },

  paint: {
    model: "flux",
    prefix:
      "oil painting, impressionist style, thick brush strokes, ",
  },

  sketch: {
    model: "flux",
    prefix:
      "pencil sketch, hand-drawn, cross-hatching, graphite, ",
  },
};

const RATIOS = {
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "4:3": [1152, 896],
  "3:4": [896, 1152],
  "21:9": [1536, 640],
  "3:2": [1216, 832],
  "2:3": [832, 1216],
};

// ============================================================
// HELPERS
// ============================================================

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-API-Key",
      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS",
      ...extraHeaders,
    },
  });
}

function error(message, status = 400, code = "BAD_REQUEST") {
  return json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    status
  );
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(
    String(value).toLowerCase()
  );
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown"
  );
}

function getBearerToken(request) {
  const authorization =
    request.headers.get("Authorization") || "";

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function getApiKey(request, url) {
  return (
    getBearerToken(request) ||
    request.headers.get("X-API-Key") ||
    url.searchParams.get("key") ||
    null
  );
}

// ============================================================
// SECURITY
// ============================================================

function safeEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  const encoder = new TextEncoder();

  const aa = encoder.encode(String(a));
  const bb = encoder.encode(String(b));

  if (aa.length !== bb.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < aa.length; i++) {
    result |= aa[i] ^ bb[i];
  }

  return result === 0;
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSign(value, secret) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value)
  );

  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticateMaster(request, env) {
  const url = new URL(request.url);
  const supplied = getApiKey(request, url);

  if (!env.MASTER_API_KEY) {
    return false;
  }

  return safeEqual(
    supplied,
    env.MASTER_API_KEY
  );
}

// ============================================================
// D1
// ============================================================

async function recordGeneration(env, data) {
  if (!env.DB) {
    return;
  }

  try {
    await env.DB.prepare(`
      INSERT INTO generations (
        id,
        user_id,
        prompt,
        negative,
        style,
        width,
        height,
        n,
        enhance,
        upscale,
        seed,
        status,
        result_data,
        error_message,
        duration_ms,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        data.id,
        data.userId ?? null,
        data.prompt,
        data.negative ?? null,
        data.style ?? null,
        data.width,
        data.height,
        data.n,
        data.enhance ? 1 : 0,
        data.upscale,
        data.seed ?? null,
        data.status,
        data.resultData
          ? JSON.stringify(data.resultData)
          : null,
        data.errorMessage ?? null,
        data.durationMs ?? null,
        data.createdAt
      )
      .run();

    if (
      data.status === "completed" &&
      data.n > 0
    ) {
      await env.DB.prepare(`
        INSERT INTO usage (
          id,
          user_id,
          generation_id,
          units,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `)
        .bind(
          uuid(),
          data.userId ?? null,
          data.id,
          data.n,
          data.createdAt
        )
        .run();
    }
  } catch (err) {
    // Database logging must never break image generation.
    console.error(
      "D1 recordGeneration failed:",
      err
    );
  }
}

// ============================================================
// SIGNED IMAGE URL
// ============================================================

async function createSignedUrl(
  imageUrl,
  env,
  expiresIn = 3600
) {
  if (!env.SIGNING_SECRET) {
    return imageUrl;
  }

  const expires =
    Math.floor(Date.now() / 1000) + expiresIn;

  const payload =
    `${imageUrl}|${expires}`;

  const signature = await hmacSign(
    payload,
    env.SIGNING_SECRET
  );

  const params = new URLSearchParams({
    url: imageUrl,
    exp: String(expires),
    sig: signature,
  });

  return `/i/${btoa(params.toString())}`;
}

// ============================================================
// IMAGE URL
// ============================================================

function buildPollinationsUrl({
  prompt,
  model,
  width,
  height,
  seed,
  enhance,
}) {
  const encodedPrompt = encodeURIComponent(
    prompt
  );

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: "true",
  });

  if (seed !== undefined && seed !== null) {
    params.set("seed", String(seed));
  }

  if (enhance) {
    params.set("enhance", "true");
  }

  return (
    `${POLLINATIONS_BASE}${encodedPrompt}` +
    `?${params.toString()}`
  );
}

function buildProcessedUrl(
  imageUrl,
  width,
  height,
  upscale
) {
  if (upscale <= 1) {
    return imageUrl;
  }

  const params = new URLSearchParams({
    url: imageUrl,
    w: String(width * upscale),
    h: String(height * upscale),
    fit: "cover",
    output: "webp",
    q: "90",
  });

  return `${WSRV_BASE}?${params.toString()}`;
}

// ============================================================
// VALIDATION
// ============================================================

function validateRequest(body) {
  if (!body || typeof body !== "object") {
    return {
      error: "Request body must be JSON.",
    };
  }

  if (
    typeof body.prompt !== "string" ||
    !body.prompt.trim()
  ) {
    return {
      error: "prompt is required.",
    };
  }

  if (body.prompt.length > 2000) {
    return {
      error:
        "prompt must be 2000 characters or less.",
    };
  }

  if (
    body.negative !== undefined &&
    typeof body.negative !== "string"
  ) {
    return {
      error: "negative must be a string.",
    };
  }

  if (
    body.style !== undefined &&
    !STYLES[String(body.style)]
  ) {
    return {
      error: `Unknown style: ${body.style}`,
    };
  }

  if (
    body.ratio !== undefined &&
    !RATIOS[String(body.ratio)]
  ) {
    return {
      error: `Unknown ratio: ${body.ratio}`,
    };
  }

  if (
    body.n !== undefined &&
    (
      !Number.isInteger(Number(body.n)) ||
      Number(body.n) < 1 ||
      Number(body.n) > 4
    )
  ) {
    return {
      error: "n must be an integer between 1 and 4.",
    };
  }

  return null;
}

// ============================================================
// GENERATION
// ============================================================

async function generateImages(
  request,
  env,
  options = {}
) {
  const started = performance.now();

  let body;

  try {
    body = await request.json();
  } catch {
    return error(
      "Invalid JSON body.",
      400,
      "INVALID_JSON"
    );
  }

  const validation = validateRequest(body);

  if (validation) {
    return error(
      validation.error,
      400,
      "VALIDATION_ERROR"
    );
  }

  const prompt = body.prompt.trim();

  const styleId = body.style
    ? String(body.style)
    : "photo";

  const style = STYLES[styleId];

  let width;
  let height;

  if (body.ratio && RATIOS[body.ratio]) {
    [width, height] = RATIOS[body.ratio];
  } else {
    width = clampNumber(
      body.width,
      256,
      1536,
      1024
    );

    height = clampNumber(
      body.height,
      256,
      1536,
      1024
    );
  }

  width = Math.round(width);
  height = Math.round(height);

  const n = clampNumber(
    body.n,
    1,
    4,
    1
  );

  const upscale = clampNumber(
    body.upscale,
    1,
    4,
    1
  );

  const enhance = parseBoolean(
    body.enhance,
    false
  );

  const crop = parseBoolean(
    body.crop,
    false
  );

  const seed =
    body.seed !== undefined &&
    body.seed !== null
      ? Number(body.seed)
      : undefined;

  const finalPrompt =
    style.prefix + prompt;

  const generationId = uuid();
  const createdAt = now();

  const images = [];

  try {
    for (let i = 0; i < n; i++) {
      const currentSeed =
        seed !== undefined
          ? seed + i
          : undefined;

      const originalUrl =
        buildPollinationsUrl({
          prompt: finalPrompt,
          model: style.model,
          width,
          height,
          seed: currentSeed,
          enhance,
        });

      let imageUrl = originalUrl;

      if (upscale > 1 || crop) {
        imageUrl = buildProcessedUrl(
          originalUrl,
          width,
          height,
          upscale
        );
      }

      const signedUrl =
        await createSignedUrl(
          imageUrl,
          env
        );

      images.push({
        index: i,
        url: signedUrl,
        source_url: imageUrl,
        width,
        height,
        seed: currentSeed ?? null,
      });
    }

    const durationMs = Math.round(
      performance.now() - started
    );

    const result = {
      id: generationId,
      status: "completed",
      prompt,
      negative:
        body.negative ?? null,
      style: styleId,
      model: style.model,
      ratio:
        body.ratio ??
        null,
      width,
      height,
      n,
      upscale,
      enhance,
      crop,
      seed:
        seed ?? null,
      images,
      duration_ms: durationMs,
      created_at: createdAt,
    };

    await recordGeneration(env, {
      id: generationId,
      userId: options.userId ?? null,
      prompt,
      negative: body.negative,
      style: styleId,
      width,
      height,
      n,
      enhance,
      upscale,
      seed,
      status: "completed",
      resultData: result,
      durationMs,
      createdAt,
    });

    return json({
      success: true,
      data: result,
    });
  } catch (err) {
    const durationMs = Math.round(
      performance.now() - started
    );

    await recordGeneration(env, {
      id: generationId,
      userId: options.userId ?? null,
      prompt,
      negative: body.negative,
      style: styleId,
      width,
      height,
      n,
      enhance,
      upscale,
      seed,
      status: "failed",
      errorMessage:
        err instanceof Error
          ? err.message
          : "Generation failed.",
      durationMs,
      createdAt,
    });

    console.error(
      "Generation failed:",
      err
    );

    return error(
      "Image generation failed.",
      502,
      "GENERATION_FAILED"
    );
  }
}

// ============================================================
// GENERATION HISTORY
// ============================================================

async function listGenerations(
  request,
  env
) {
  if (!env.DB) {
    return error(
      "Database is not configured.",
      503,
      "DATABASE_UNAVAILABLE"
    );
  }

  const url = new URL(request.url);

  const limit = clampNumber(
    url.searchParams.get("limit"),
    1,
    100,
    20
  );

  const offset = clampNumber(
    url.searchParams.get("offset"),
    0,
    100000,
    0
  );

  try {
    const result = await env.DB.prepare(`
      SELECT
        id,
        user_id,
        prompt,
        negative,
        style,
        width,
        height,
        n,
        enhance,
        upscale,
        seed,
        status,
        result_data,
        error_message,
        duration_ms,
        created_at
      FROM generations
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
      .bind(
        Math.round(limit),
        Math.round(offset)
      )
      .all();

    return json({
      success: true,
      data: result.results || [],
      pagination: {
        limit: Math.round(limit),
        offset: Math.round(offset),
      },
    });
  } catch (err) {
    console.error(
      "History query failed:",
      err
    );

    return error(
      "Unable to load generation history.",
      500,
      "DATABASE_ERROR"
    );
  }
}

async function getGeneration(
  request,
  env,
  id
) {
  if (!env.DB) {
    return error(
      "Database is not configured.",
      503,
      "DATABASE_UNAVAILABLE"
    );
  }

  try {
    const result = await env.DB.prepare(`
      SELECT *
      FROM generations
      WHERE id = ?
      LIMIT 1
    `)
      .bind(id)
      .first();

    if (!result) {
      return error(
        "Generation not found.",
        404,
        "NOT_FOUND"
      );
    }

    return json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error(
      "Generation lookup failed:",
      err
    );

    return error(
      "Unable to load generation.",
      500,
      "DATABASE_ERROR"
    );
  }
}

// ============================================================
// SIGNED IMAGE ROUTE
// ============================================================

async function serveSignedImage(
  request,
  env,
  token
) {
  if (!env.SIGNING_SECRET) {
    return error(
      "Signing is not configured.",
      503,
      "SIGNING_UNAVAILABLE"
    );
  }

  let decoded;

  try {
    decoded = atob(token);
  } catch {
    return error(
      "Invalid image token.",
      400,
      "INVALID_TOKEN"
    );
  }

  const params = new URLSearchParams(
    decoded
  );

  const imageUrl = params.get("url");
  const exp = Number(
    params.get("exp")
  );
  const signature = params.get("sig");

  if (
    !imageUrl ||
    !exp ||
    !signature
  ) {
    return error(
      "Invalid image token.",
      400,
      "INVALID_TOKEN"
    );
  }

  if (
    Math.floor(Date.now() / 1000) >
    exp
  ) {
    return error(
      "Image URL has expired.",
      410,
      "EXPIRED"
    );
  }

  const expected =
    await hmacSign(
      `${imageUrl}|${exp}`,
      env.SIGNING_SECRET
    );

  if (
    !safeEqual(
      signature,
      expected
    )
  ) {
    return error(
      "Invalid image signature.",
      403,
      "INVALID_SIGNATURE"
    );
  }

  try {
    const response = await fetch(
      imageUrl
    );

    if (!response.ok) {
      return error(
        "Unable to retrieve image.",
        502,
        "UPSTREAM_ERROR"
      );
    }

    const headers =
      new Headers(response.headers);

    headers.set(
      "Cache-Control",
      "public, max-age=3600"
    );

    headers.set(
      "Access-Control-Allow-Origin",
      "*"
    );

    return new Response(
      response.body,
      {
        status: response.status,
        headers,
      }
    );
  } catch (err) {
    console.error(
      "Signed image fetch failed:",
      err
    );

    return error(
      "Unable to retrieve image.",
      502,
      "UPSTREAM_ERROR"
    );
  }
}

// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(
      request.url
    );

    // --------------------------------------------------------
    // CORS PREFLIGHT
    // --------------------------------------------------------

    if (
      request.method === "OPTIONS"
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":
            "*",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-API-Key",
          "Access-Control-Allow-Methods":
            "GET, POST, OPTIONS",
          "Access-Control-Max-Age":
            "86400",
        },
      });
    }

    // --------------------------------------------------------
    // ROOT
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return json({
        success: true,
        service: SERVICE.name,
        version: SERVICE.version,
        status: "online",
        endpoints: {
          health: "/v1/health",
          styles: "/v1/styles",
          ratios: "/v1/ratios",
          generate: "/v1/images/generate",
          legacy_generate: "/v1/image",
          generations: "/v1/generations",
        },
      });
    }

    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/v1/health"
    ) {
      let database = false;

      if (env.DB) {
        try {
          await env.DB
            .prepare(
              "SELECT 1 AS ok"
            )
            .first();

          database = true;
        } catch {
          database = false;
        }
      }

      return json({
        success: true,
        service: SERVICE.name,
        version: SERVICE.version,
        status: "healthy",
        database,
        timestamp: new Date().toISOString(),
      });
    }

    // --------------------------------------------------------
    // STYLES
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/v1/styles"
    ) {
      return json({
        success: true,
        data: Object.entries(
          STYLES
        ).map(
          ([id, value]) => ({
            id,
            model: value.model,
          })
        ),
      });
    }

    // --------------------------------------------------------
    // RATIOS
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/v1/ratios"
    ) {
      return json({
        success: true,
        data: Object.entries(
          RATIOS
        ).map(
          ([id, dimensions]) => ({
            id,
            width: dimensions[0],
            height: dimensions[1],
          })
        ),
      });
    }

    // --------------------------------------------------------
    // SIGNED IMAGE
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname.startsWith(
        "/i/"
      )
    ) {
      const token =
        url.pathname.slice(3);

      return serveSignedImage(
        request,
        env,
        token
      );
    }

    // --------------------------------------------------------
    // GENERATION HISTORY
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname ===
        "/v1/generations"
    ) {
      const authenticated =
        await authenticateMaster(
          request,
          env
        );

      if (!authenticated) {
        return error(
          "Authentication required.",
          401,
          "UNAUTHORIZED"
        );
      }

      return listGenerations(
        request,
        env
      );
    }

    // --------------------------------------------------------
    // SINGLE GENERATION
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname.startsWith(
        "/v1/generations/"
      )
    ) {
      const authenticated =
        await authenticateMaster(
          request,
          env
        );

      if (!authenticated) {
        return error(
          "Authentication required.",
          401,
          "UNAUTHORIZED"
        );
      }

      const id =
        url.pathname.slice(
          "/v1/generations/".length
        );

      if (!id) {
        return error(
          "Generation ID is required.",
          400
        );
      }

      return getGeneration(
        request,
        env,
        id
      );
    }

    // --------------------------------------------------------
    // IMAGE GENERATION
    // --------------------------------------------------------

    if (
      request.method === "POST" &&
      (
        url.pathname ===
          "/v1/images/generate" ||
        url.pathname ===
          "/v1/image"
      )
    ) {
      const authenticated =
        await authenticateMaster(
          request,
          env
        );

      if (!authenticated) {
        return error(
          "Authentication required.",
          401,
          "UNAUTHORIZED"
        );
      }

      return generateImages(
        request,
        env
      );
    }

    // --------------------------------------------------------
    // LEGACY GET /v1/image
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/v1/image"
    ) {
      const authenticated =
        await authenticateMaster(
          request,
          env
        );

      if (!authenticated) {
        return error(
          "Authentication required.",
          401,
          "UNAUTHORIZED"
        );
      }

      const prompt =
        url.searchParams.get(
          "prompt"
        );

      if (!prompt) {
        return error(
          "prompt is required.",
          400,
          "VALIDATION_ERROR"
        );
      }

      const body = {
        prompt,
        negative:
          url.searchParams.get(
            "negative"
          ) || undefined,
        style:
          url.searchParams.get(
            "style"
          ) || "photo",
        ratio:
          url.searchParams.get(
            "ratio"
          ) || undefined,
        width:
          url.searchParams.get(
            "width"
          ) || undefined,
        height:
          url.searchParams.get(
            "height"
          ) || undefined,
        n:
          url.searchParams.get(
            "n"
          ) || 1,
        upscale:
          url.searchParams.get(
            "upscale"
          ) || 1,
        enhance:
          url.searchParams.get(
            "enhance"
          ),
        crop:
          url.searchParams.get(
            "crop"
          ),
        seed:
          url.searchParams.get(
            "seed"
          ) || undefined,
      };

      const internalRequest =
        new Request(
          request.url,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(
              body
            ),
          }
        );

      return generateImages(
        internalRequest,
        env
      );
    }

    // --------------------------------------------------------
    // 404
    // --------------------------------------------------------

    return error(
      "Endpoint not found.",
      404,
      "NOT_FOUND"
    );
  },
};

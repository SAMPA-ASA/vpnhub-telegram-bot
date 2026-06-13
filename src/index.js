import { ensureBootstrap } from "./storage.js";
import { handleUpdate } from "./bot.js";
import { attachDebugContext, buildDebugResponse, createDebugContext, debugLog } from "./debug.js";

// Keep the entrypoint changing when imported modules change so Wrangler rebuilds the bundle.
const BUILD_STAMP = "2026-06-09";

export default {
  async fetch(request, env) {
    void BUILD_STAMP;
    const debug = attachDebugContext(env, createDebugContext(env));
    debugLog(env, "info", "request.start", {
      method: request.method,
      url: request.url,
    });

    try {
      const url = new URL(request.url);
      debugLog(env, "info", "request.route", { pathname: url.pathname });

      if (url.pathname === "/health") {
        debugLog(env, "info", "request.health");
        return buildDebugResponse(debug, 200, "ok");
      }

      debugLog(env, "info", "bootstrap.start");
      await ensureBootstrap(env);
      debugLog(env, "info", "bootstrap.ready");

      if (url.pathname !== `/webhook/${env.WEBHOOK_SECRET}`) {
        debugLog(env, "warn", "request.not_found", {
          expected: `/webhook/${env.WEBHOOK_SECRET}`,
        });
        return buildDebugResponse(debug, 404, "not found");
      }

      if (request.method !== "POST") {
        debugLog(env, "warn", "request.method_not_allowed", {
          method: request.method,
        });
        return buildDebugResponse(debug, 405, "method not allowed");
      }

      const rawBody = await request.text();
      debugLog(env, "info", "request.body", { rawBody });

      const update = rawBody ? JSON.parse(rawBody) : {};
      debugLog(env, "info", "request.update", {
        keys: Object.keys(update || {}),
      });

      await handleUpdate(update, env);
    } catch (error) {
      console.error(error);
      debugLog(env, "error", "request.error", {
        message: error?.message || String(error),
        stack: error?.stack,
      });

      if (request.method === "POST") {
        return buildDebugResponse(debug, 200, "ok", {
          error: error?.message || String(error),
        });
      }

      return buildDebugResponse(debug, 500, "internal error", {
        error: error?.message || String(error),
      });
    }

    debugLog(env, "info", "request.complete");
    return buildDebugResponse(debug, 200, "ok");
  },
};

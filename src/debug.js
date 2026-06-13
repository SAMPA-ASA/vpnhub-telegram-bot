function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export function isDebugEnabled(env) {
  return isTruthy(env?.DEBUG) || isTruthy(env?.DEBUG_LOGS) || isTruthy(env?.DEBUG_MODE);
}

export function createDebugContext(env) {
  const enabled = isDebugEnabled(env);
  const logs = [];
  const deploymentId = env?.DEPLOYMENT_ID || env?.CF_VERSION_METADATA?.id || null;

  return {
    enabled,
    logs,
    deploymentId,
    log(level, event, details = undefined) {
      if (!enabled) {
        return;
      }

      const entry = {
        at: new Date().toISOString(),
        level,
        event,
      };

      if (details !== undefined) {
        entry.details = details;
      }

      logs.push(entry);
    },
  };
}

export function attachDebugContext(env, context) {
  if (env && typeof env === "object") {
    env.__debug = context;
  }
  return context;
}

export function getDebugContext(env) {
  return env?.__debug || null;
}

export function debugLog(env, level, event, details = undefined) {
  const context = getDebugContext(env);
  if (!context) {
    return;
  }

  context.log(level, event, details);
}

export function buildDebugResponse(debug, status, body, extra = {}) {
  if (!debug?.enabled) {
    return new Response(body, { status });
  }

  return new Response(
    JSON.stringify(
      {
        ok: status < 400,
        status,
        body,
        deploymentId: debug.deploymentId,
        logs: debug.logs,
        ...extra,
      },
      null,
      2,
    ),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}

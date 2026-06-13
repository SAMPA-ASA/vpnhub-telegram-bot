export function installTelegramMock(routes = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : String(input.url);
    const method = init.method || "GET";
    calls.push({ url, method, init });

    if (url.includes("/getFile")) {
      const payload = init.body ? JSON.parse(init.body) : {};
      const filePath = routes.telegramFiles?.[payload.file_id] || routes.defaultFilePath || "mock-backup.json";
      return jsonResponse({ ok: true, result: { file_path: filePath } });
    }

    if (url.includes("/file/bot")) {
      const filePath = url.split("/file/bot")[1]?.split("/").slice(1).join("/");
      const fileText = routes.telegramFiles?.[filePath] ?? routes.fileContent ?? "{}";
      return textResponse(fileText);
    }

    if (
      url.includes("/sendMessage") ||
      url.includes("/editMessageText") ||
      url.includes("/sendDocument") ||
      url.includes("/copyMessage") ||
      url.includes("/answerCallbackQuery")
    ) {
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body) {
  return new Response(String(body), {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

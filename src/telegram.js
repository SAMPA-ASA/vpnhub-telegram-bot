import { debugLog } from "./debug.js";

export async function telegramRequest(env, method, payload) {
  debugLog(env, "info", "telegram.request", {
    method,
    payload: payload instanceof FormData ? "[form-data]" : payload,
  });

  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: payload instanceof FormData ? undefined : { "content-type": "application/json" },
    body: payload instanceof FormData ? payload : JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({
    ok: false,
    description: "invalid telegram response",
  }));

  if (!data.ok) {
    debugLog(env, "error", "telegram.response.error", {
      method,
      status: response.status,
      description: data.description || response.statusText,
    });
    throw new Error(`${method} failed: ${data.description || response.statusText}`);
  }

  debugLog(env, "info", "telegram.response.ok", {
    method,
    status: response.status,
  });

  return data.result;
}

export async function sendMessage(env, chatId, text, replyMarkup = null, disablePreview = false) {
  return telegramRequest(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: disablePreview,
    reply_markup: replyMarkup || undefined,
  });
}

export async function editMessageText(env, chatId, messageId, text, replyMarkup = null, disablePreview = false) {
  return telegramRequest(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: disablePreview,
    reply_markup: replyMarkup || undefined,
  });
}

export async function sendDocument(env, chatId, fileName, content, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption || "");
  form.append("parse_mode", "HTML");
  form.append("document", new Blob([content], { type: "application/json" }), fileName);
  return telegramRequest(env, "sendDocument", form);
}

export async function copyMessage(env, fromChatId, messageId, toChatId) {
  return telegramRequest(env, "copyMessage", {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  });
}

export async function answerCallback(env, callbackQueryId, text) {
  try {
    await telegramRequest(env, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text || undefined,
      show_alert: Boolean(text),
    });
  } catch (error) {
    console.error(error);
    debugLog(env, "error", "telegram.answerCallback.failed", {
      message: error?.message || String(error),
    });
  }
}

export async function getTelegramFile(env, fileId) {
  return telegramRequest(env, "getFile", { file_id: fileId });
}

export async function downloadTelegramFile(env, fileId) {
  const file = await getTelegramFile(env, fileId);
  if (!file?.file_path) {
    throw new Error("Telegram file path missing");
  }

  const response = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) {
    throw new Error(`File download failed: ${response.status}`);
  }

  return response.text();
}

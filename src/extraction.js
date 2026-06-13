import { listProtocols } from "./storage.js";
import { getMessageText, normalizeTextInput } from "./utils.js";

export function channelKeysFromChat(chat) {
  const keys = [String(chat.id)];
  if (chat.username) {
    keys.push(`@${String(chat.username).toLowerCase()}`);
  }
  return [...new Set(keys)];
}

export function buildSourceLabel(chat) {
  if (chat.username) {
    return `@${chat.username}`;
  }

  if (chat.title) {
    return `${chat.title} (${chat.id})`;
  }

  return String(chat.id);
}

export function extractChannelReference(message) {
  if (message?.forward_from_chat && message.forward_from_chat.type === "channel") {
    const chat = message.forward_from_chat;
    return {
      channelKey: String(chat.id),
      channelUsername: chat.username ? String(chat.username).toLowerCase() : null,
      channelTitle: chat.title || null,
    };
  }

  const text = normalizeTextInput(getMessageText(message));
  if (!text) {
    return null;
  }

  if (/^-?\d+$/.test(text)) {
    return {
      channelKey: String(text),
      channelUsername: null,
      channelTitle: null,
    };
  }

  const match = text.match(/^(?:https?:\/\/)?t\.me\/(?:s\/)?([A-Za-z0-9_]+)$/i) || text.match(/^@([A-Za-z0-9_]+)$/);
  if (!match) {
    return null;
  }

  const username = match[1].toLowerCase();
  return {
    channelKey: `@${username}`,
    channelUsername: username,
    channelTitle: null,
  };
}

export async function isChannelAllowed(env, chat, mode) {
  const keys = channelKeysFromChat(chat);
  if (!keys.length) {
    return false;
  }

  const placeholders = keys.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT list_type, channel_key FROM channel_lists WHERE channel_key IN (${placeholders})`
  ).bind(...keys).all();

  const hits = rows.results || [];
  const whiteHit = hits.some((row) => row.list_type === "white");
  const blackHit = hits.some((row) => row.list_type === "black");

  return mode === "white" ? whiteHit : !blackHit;
}

export async function searchProtocols(env, query) {
  const normalized = normalizeTextInput(query).toLowerCase();
  if (!normalized) {
    return [];
  }

  const rows = await listProtocols(env);
  return rows
    .map((row) => ({
      row,
      score: protocolScore(normalized, `${row.pattern} ${row.type_name}`.toLowerCase()),
    }))
    .filter((item) => item.score > 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((item) => item.row);
}

export async function findProtocolByQuery(env, query) {
  const normalized = normalizeTextInput(query).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    const rows = await listProtocols(env);
    const byId = rows.find((row) => String(row.id) === normalized);
    if (byId) {
      return byId;
    }
  }

  const rows = await listProtocols(env);
  let best = null;
  let bestScore = 0;

  for (const row of rows) {
    const score = protocolScore(normalized, `${row.pattern} ${row.type_name}`.toLowerCase());
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }

  return bestScore > 0.2 ? best : null;
}

export async function getEnabledProtocolsForScan(env) {
  const rows = await env.DB.prepare(
    "SELECT * FROM protocols WHERE enabled = 1 ORDER BY LENGTH(pattern) DESC, id ASC"
  ).all();
  return rows.results || [];
}

export function extractConfigsFromMessage(message, protocols) {
  const sources = [];
  const text = getMessageText(message);
  if (text) {
    sources.push(text);
  }

  if (message?.reply_markup) {
    sources.push(...extractUrlsFromReplyMarkup(message.reply_markup));
  }

  if (message?.entities) {
    sources.push(...extractUrlsFromEntities(message.entities, text));
  }

  if (message?.caption_entities) {
    sources.push(...extractUrlsFromEntities(message.caption_entities, message.caption || ""));
  }

  if (message?.caption) {
    sources.push(message.caption);
  }

  const result = new Map();
  const sortedProtocols = [...protocols].sort((a, b) => String(b.pattern).length - String(a.pattern).length);

  for (const source of sources) {
    const sourceText = String(source || "");
    const lower = sourceText.toLowerCase();

    for (const protocol of sortedProtocols) {
      const pattern = String(protocol.pattern || "").toLowerCase();
      if (!pattern) {
        continue;
      }

      let index = 0;
      while ((index = lower.indexOf(pattern, index)) !== -1) {
        if (!isProtocolBoundary(sourceText, index)) {
          index += pattern.length;
          continue;
        }

        const candidate = extractCandidateUrl(sourceText, index);
        if (candidate && candidate.toLowerCase().startsWith(pattern)) {
          result.set(candidate, {
            url: candidate,
            protocolType: protocol.type_name,
            protocolPattern: protocol.pattern,
          });
        }
        index += pattern.length;
      }
    }
  }

  return [...result.values()];
}

export function renderConfigForwardMessage(sourceLabel, config) {
  return [
    "📡 <b>کانفیگ جدید</b>",
    `منبع: ${escapeHtml(sourceLabel)}`,
    `نوع: <b>${escapeHtml(config.protocolType)}</b>`,
    "",
    `<code>${escapeHtml(config.url)}</code>`,
  ].join("\n");
}

function extractUrlsFromReplyMarkup(replyMarkup) {
  const urls = [];
  for (const row of replyMarkup?.inline_keyboard || []) {
    for (const button of row || []) {
      if (button?.url) {
        urls.push(button.url);
      }
    }
  }
  return urls;
}

function extractUrlsFromEntities(entities, text) {
  const urls = [];
  for (const entity of entities || []) {
    if (entity.type === "text_link" && entity.url) {
      urls.push(entity.url);
    }

    if (entity.type === "url" && text) {
      urls.push(text.slice(entity.offset, entity.offset + entity.length));
    }
  }
  return urls;
}

function extractCandidateUrl(text, startIndex) {
  const delimiters = new Set([" ", "\n", "\r", "\t", "<", ">", "\"", "'", "`", ")", "(", "]", "[", "}", "{", "|", "،"]);
  let endIndex = startIndex;
  while (endIndex < text.length && !delimiters.has(text[endIndex])) {
    endIndex += 1;
  }

  return text.slice(startIndex, endIndex).trim().replace(/[),.!؟?؛]+$/g, "");
}

function isProtocolBoundary(text, index) {
  if (index <= 0) {
    return true;
  }

  return !/[A-Za-z0-9+.-]/.test(text[index - 1]);
}
function protocolScore(query, candidate) {
  if (!query || !candidate) {
    return 0;
  }

  if (query === candidate) {
    return 1;
  }

  let score = 0;
  if (candidate.includes(query)) {
    score += 0.6;
  }

  const distance = levenshtein(query, candidate);
  const base = Math.max(query.length, candidate.length) || 1;
  return score + 0.4 * (1 - distance / base);
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

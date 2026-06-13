export function normalizeTextInput(value) {
  return String(value || "").replace(/\u200c/g, "").trim();
}

export function normalizeChatId(value) {
  const text = normalizeTextInput(value);
  return /^-?\d+$/.test(text) ? String(text) : null;
}

export function getMessageText(message) {
  return String(message?.text || message?.caption || "");
}

export function parsePairInput(value) {
  const text = normalizeTextInput(value);
  const separator = text.includes("|")
    ? "|"
    : text.includes("=>")
      ? "=>"
      : text.includes("=")
        ? "="
        : null;

  if (!separator) {
    return null;
  }

  const [left, ...rest] = text.split(separator);
  const right = rest.join(separator).trim();
  const pattern = left.trim();
  if (!pattern || !right) {
    return null;
  }

  return { left: pattern, right };
}

export function nowIso() {
  return new Date().toISOString();
}

export function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function boolInt(value) {
  return value ? 1 : 0;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function clonePermissions(permissionKeys) {
  return Object.fromEntries(permissionKeys.map(([key]) => [key, false]));
}

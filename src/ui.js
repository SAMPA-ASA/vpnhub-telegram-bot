import { PERMISSIONS } from "./constants.js";
import { escapeHtml } from "./utils.js";

export function mainKeyboard(admin) {
  const rows = [[{ text: "📊 وضعیت", callback_data: "menu:status" }]];

  const firstRow = [];
  if (hasProtocolMenuAccess(admin)) {
    firstRow.push({ text: "🧩 پروتکل‌ها", callback_data: "menu:protocols" });
  }
  if (hasAnyListAccess(admin)) {
    firstRow.push({ text: "📋 لیست‌ها", callback_data: "menu:lists" });
  }
  if (firstRow.length) {
    rows.push(firstRow);
  }

  const secondRow = [];
  if (hasTargetChannelAccess(admin)) {
    secondRow.push({ text: "🎯 کانال مقصد", callback_data: "act:target_channel" });
  }
  if (secondRow.length) {
    rows.push(secondRow);
  }

  if (isOwner(admin)) {
    rows.push([
      { text: "📨 ارسال پیام", callback_data: "act:send_message" },
      { text: "♻️ بازیابی بکاپ", callback_data: "act:restore_backup" },
    ]);
    rows.push([
      { text: "🛡 ادمین‌ها", callback_data: "menu:admins" },
      { text: "🗂 بکاپ", callback_data: "act:backup" },
    ]);
  }

  return { inline_keyboard: rows };
}

export function guestMainKeyboard(settings, env) {
  const rows = [];
  const firstRow = [];

  const targetChannelUrl = resolveTelegramUrl(settings?.target_channel_id || env?.TARGET_CHANNEL_ID);
  if (targetChannelUrl) {
    firstRow.push({ text: "کانال هدف", url: targetChannelUrl });
  }

  const developerChannelUrl = resolveTelegramUrl(env?.ADMIN_CHANNEL_ID);
  if (developerChannelUrl) {
    firstRow.push({ text: "کانال توسعه‌دهنده", url: developerChannelUrl });
  }

  if (firstRow.length) {
    rows.push(firstRow);
  }

  const supportUrl = resolveTelegramUrl(env?.ADMIN_SUPPORT_DIRECT_URL);
  if (supportUrl) {
    rows.push([{ text: "پشتیبانی", url: supportUrl }]);
  }

  return { inline_keyboard: rows };
}

export function statusKeyboard(mode, admin) {
  const rows = [];
  const firstRow = [];

  if (canViewPermission(admin, "can_toggle_bot")) {
    firstRow.push({ text: "روشن/خاموش", callback_data: "toggle:bot" });
  }
  if (firstRow.length) {
    rows.push(firstRow);
  }

  if (canViewPermission(admin, "can_manage_mode")) {
    rows.push([
      { text: `Black List${mode === "black" ? " ✅" : ""}`, callback_data: "mode:black" },
      { text: `White List${mode === "white" ? " ✅" : ""}`, callback_data: "mode:white" },
    ]);
  }

  rows.push([{ text: "🏠 منوی اصلی", callback_data: "menu:main" }]);
  return { inline_keyboard: rows };
}

export function protocolKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "➕ افزودن", callback_data: "act:protocol_add" },
        { text: "🔎 جستجو", callback_data: "act:protocol_search" },
      ],
      [
        { text: "📚 لیست", callback_data: "act:protocol_list" },
        { text: "✏️ ویرایش", callback_data: "act:protocol_edit" },
      ],
      [
        { text: "🗑 حذف", callback_data: "act:protocol_delete" },
        { text: "🏠 منوی اصلی", callback_data: "menu:main" },
      ],
    ],
  };
}

export function sessionCancelKeyboard() {
  return {
    inline_keyboard: [[{ text: "لغو ❌", callback_data: "act:cancel_edit" }]],
  };
}

export function listRootKeyboard(admin) {
  const rows = [];
  const row = [];
  if (canViewPermission(admin, "can_manage_whitelist")) {
    row.push({ text: "📗 لیست سفید", callback_data: "menu:white_list" });
  }
  if (canViewPermission(admin, "can_manage_blacklist")) {
    row.push({ text: "📕 لیست سیاه", callback_data: "menu:black_list" });
  }
  if (row.length) {
    rows.push(row);
  }
  rows.push([{ text: "🏠 منوی اصلی", callback_data: "menu:main" }]);
  return { inline_keyboard: rows };
}

export function listKeyboard(admin, listType) {
  const canManage = listType === "white"
    ? canViewPermission(admin, "can_manage_whitelist")
    : canViewPermission(admin, "can_manage_blacklist");

  const rows = [];
  if (canManage) {
    rows.push([
      { text: "➕ افزودن", callback_data: `act:${listType}_add` },
      { text: "🗑 حذف", callback_data: `act:${listType}_remove` },
    ]);
  }
  rows.push([{ text: "🏠 منوی اصلی", callback_data: "menu:lists" }]);
  return { inline_keyboard: rows };
}

export function adminKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "➕ افزودن ادمین", callback_data: "act:admins_add" },
        { text: "👥 لیست ادمین‌ها", callback_data: "act:admins_list" },
      ],
      [
        { text: "✏️ ویرایش سطح", callback_data: "act:admins_edit" },
        { text: "🗑 حذف ادمین", callback_data: "act:admins_remove" },
      ],
      [{ text: "🏠 منوی اصلی", callback_data: "menu:main" }],
    ],
  };
}

export function adminSelectionKeyboard(admins, selfChatId, actionKey = "admins_edit_pick") {
  const rows = [];
  const filtered = admins.filter((admin) => String(admin.chat_id) !== String(selfChatId));

  for (let index = 0; index < filtered.length; index += 2) {
    const row = [];
    const first = filtered[index];
    row.push({
      text: renderAdminButtonLabel(first),
      callback_data: `act:${actionKey}:${first.chat_id}`,
    });

    const second = filtered[index + 1];
    if (second) {
      row.push({
        text: renderAdminButtonLabel(second),
        callback_data: `act:${actionKey}:${second.chat_id}`,
      });
    }

    rows.push(row);
  }

  rows.push([{ text: "🏠 بازگشت", callback_data: "menu:admins" }]);
  return { inline_keyboard: rows };
}

export function permissionKeyboard(permissions) {
  return {
    inline_keyboard: [
      [
        { text: permissionButtonLabel(permissions, "can_toggle_bot"), callback_data: "perm:toggle_can_toggle_bot" },
        { text: permissionButtonLabel(permissions, "can_manage_whitelist"), callback_data: "perm:toggle_can_manage_whitelist" },
      ],
      [
        { text: permissionButtonLabel(permissions, "can_manage_blacklist"), callback_data: "perm:toggle_can_manage_blacklist" },
        { text: permissionButtonLabel(permissions, "can_manage_mode"), callback_data: "perm:toggle_can_manage_mode" },
      ],
      [
        { text: permissionButtonLabel(permissions, "can_manage_target_channel"), callback_data: "perm:toggle_can_manage_target_channel" },
        { text: permissionButtonLabel(permissions, "can_manage_protocol_add"), callback_data: "perm:toggle_can_manage_protocol_add" },
      ],
      [
        { text: permissionButtonLabel(permissions, "can_manage_protocol_edit"), callback_data: "perm:toggle_can_manage_protocol_edit" },
        { text: permissionButtonLabel(permissions, "can_manage_protocol_delete"), callback_data: "perm:toggle_can_manage_protocol_delete" },
      ],
      [
        { text: "✅ همه", callback_data: "perm:all" },
        { text: "🚫 هیچ‌کدام", callback_data: "perm:none" },
      ],
      [
        { text: "💾 ذخیره", callback_data: "perm:save" },
        { text: "لغو ❌", callback_data: "perm:cancel" },
      ],
    ],
  };
}

export function confirmationKeyboard(actionKey) {
  return {
    inline_keyboard: [[
      { text: "✅ بله", callback_data: `confirm:${actionKey}:yes` },
      { text: "❌ خیر", callback_data: `confirm:${actionKey}:no` },
    ]],
  };
}

export function backupRestoreKeyboard() {
  return {
    inline_keyboard: [[{ text: "🏠 منوی اصلی", callback_data: "menu:main" }]],
  };
}

export function buildMainText(settings, targetChannel) {
  return [
    "<b>پنل مدیریت VPN Hub</b>",
    "",
    `وضعیت: ${settings.enabled === "1" ? "روشن ✅" : "خاموش ❌"}`,
    `حالت کپی: ${settings.copy_mode === "white" ? "White List" : "Black List"}`,
    `کانال مقصد: <code>${escapeHtml(String(targetChannel || "تنظیم نشده"))}</code>`,
  ].join("\n");
}

export function buildGuestMainText(settings, env) {
  const targetChannel = resolveDisplayValue(settings?.target_channel_id || env?.TARGET_CHANNEL_ID, "TARGET_CHANNEL_ID");
  const developerChannel = resolveDisplayValue(env?.ADMIN_CHANNEL_ID, "ADMIN_CHANNEL_ID");
  const supportUrl = resolveDisplayValue(env?.ADMIN_SUPPORT_DIRECT_URL, "ADMIN_SUPPORT_DIRECT_URL");

  const instruction = settings?.copy_mode === "white"
    ? `برای اینکه کانفیگ‌‎هایی که در کانال خودتون ارسال میکنید رو در کانال ${escapeHtml(targetChannel)} بفرستم، کافیه من رو در کانال خودون، بدون هیچ دسترسی، ادمین کنید و کانال خودتون رو به پشتیبانی، معرفی کنید.`
    : `برای اینکه کانفیگ‌‎هایی که در کانال خودتون ارسال میکنید رو در کانال ${escapeHtml(targetChannel)} بفرستم، کافیه من رو در کانال خودون، بدون هیچ دسترسی، ادمین کنید.`;

  return [
    "درود ❤️",
    "من ربات کانال VPN Hub هستم.",
    "",
    instruction,
    "",
    `کانال تلگرمی توسعه دهنده: ${escapeHtml(developerChannel)}`,
    `پشتیبانی: ${escapeHtml(supportUrl)}`,
  ].join("\n");
}

export function buildStatusText(settings, targetChannel) {
  return [
    "<b>وضعیت سرویس</b>",
    "",
    `روشن/خاموش: ${settings.enabled === "1" ? "روشن ✅" : "خاموش ❌"}`,
    `حالت کپی: ${settings.copy_mode === "white" ? "White List" : "Black List"}`,
    `کانال مقصد: <code>${escapeHtml(String(targetChannel || "تنظیم نشده"))}</code>`,
  ].join("\n");
}

export function protocolMenuText() {
  return "<b>مدیریت پروتکل‌ها</b>\n\nاز دکمه‌ها برای افزودن، ویرایش یا حذف پروتکل استفاده کنید.";
}

export function listRootText() {
  return "<b>مدیریت لیست‌ها</b>\n\nیکی از لیست‌ها را برای مدیریت انتخاب کنید.";
}

export function buildProtocolListText(protocols) {
  if (!protocols.length) {
    return "هنوز پروتکلی ثبت نشده است.";
  }

  return [
    "<b>لیست پروتکل‌ها:</b>",
    "",
    ...protocols.map((row) => `#${row.id} • <code>${escapeHtml(row.pattern)}</code> → <b>${escapeHtml(row.type_name)}</b> ${Number(row.enabled) ? "✅" : "❌"}`),
  ].join("\n");
}

export function buildChannelListText(listType, rows) {
  if (!rows.length) {
    return "هنوز موردی در این لیست ثبت نشده است.";
  }

  return [
    `لیست ${listType === "white" ? "سفید" : "سیاه"}:`,
    "",
    ...rows.map((row) => `#${row.id} • <code>${escapeHtml(row.channel_key)}</code>${row.channel_title ? ` • ${escapeHtml(row.channel_title)}` : ""}`),
  ].join("\n");
}

export function buildAdminsListText(admins) {
  if (!admins.length) {
    return "هنوز هیچ ادمینی ثبت نشده است.";
  }

  return [
    "<b>لیست ادمین‌ها:</b>",
    "",
    ...admins.map(renderAdminSummary),
  ].join("\n\n");
}

export function buildAdminSelectionText(admins) {
  if (!admins.length) {
    return "ادمین دیگری برای انتخاب وجود ندارد.";
  }

  return "یکی از ادمین‌ها را انتخاب کنید:";
}

export function renderPermissionPanel(targetChatId, permissions, mode) {
  const lines = [
    `Chat ID: <code>${escapeHtml(String(targetChatId))}</code>`,
    `حالت: <b>${mode === "edit" ? "ویرایش" : "افزودن"}</b>`,
    "",
    "سطح دسترسی‌ها:",
  ];

  for (const [key, label] of PERMISSIONS) {
    lines.push(`${permissions[key] ? "✅" : "❌"} ${label}`);
  }

  lines.push("", "برای تغییر هر گزینه از دکمه‌های زیر استفاده کنید.");
  return lines.join("\n");
}

export function helpText() {
  return [
    "/start - نمایش منوی اصلی",
    "/id - نمایش Chat ID",
    "/cancel - لغو عملیات فعلی",
  ].join("\n");
}

export function disclaimerText() {
  return [
    "<b>اطلاعیه شفافیت، حریم خصوصی و سلب مسئولیت</b>",
    "",
    "این ربات تلگرامی صرفاً با هدف بازنشر کانفیگ‌های منتشرشده در کانال‌های عمومی، همراه با ذکر منبع، فعالیت می‌کند.",
    "",
    "• توسعه‌دهنده این ربات ممکن است برای ارائه و مدیریت خدمات ربات، برخی اطلاعات فنی و حداقلی موردنیاز و یا داده‌های ضروری برای پردازش درخواست‌ها (Requests) را ذخیره یا پردازش کند. این اطلاعات صرفاً در چارچوب عملکرد ربات استفاده می‌شوند. با این حال، بخشی از زیرساخت و پردازش داده‌ها ممکن است توسط ارائه‌دهندگان خدمات ثالث (از جمله Cloudflare) انجام شود و توسعه‌دهنده مسئولیتی در قبال نحوه نگهداری، پردازش یا افشای احتمالی اطلاعات توسط این ارائه‌دهندگان ندارد.",
    "",
    "• کانفیگ‌های ارسال‌شده توسط این ربات از منابع عمومی گردآوری می‌شوند. توسعه‌دهنده مسئولیتی در قبال صحت، پایداری، امنیت، عملکرد یا محتوای این کانفیگ‌ها ندارد و استفاده از آن‌ها بر عهده کاربر است.",
    "",
    "• بازنشر کانفیگ‌ها به معنای تأیید، تضمین یا وابستگی توسعه‌دهنده به منابع منتشرکننده آن‌ها نیست.",
    "",
    "• در صورت وجود هرگونه درخواست درباره حذف محتوا، اصلاح منبع یا گزارش مشکل، می‌توان موضوع را از طریق راه ارتباطی اعلام‌شده با توسعه‌دهنده یا پشتیبانی مطرح کرد.",
  ].join("\n");
}

export function restorePromptText() {
  return [
    "<b>بازیابی بکاپ</b>",
    "",
    "فایل JSON بکاپ را ارسال کنید تا بازیابی انجام شود.",
    "اگر فایل معتبر نباشد، عملیات لغو می‌شود.",
  ].join("\n");
}

export function restorePreviewText(summary) {
  return [
    "<b>پیش‌نمایش بازیابی</b>",
    "",
    `تنظیمات: ${summary.settings}`,
    `پروتکل‌ها: ${summary.protocols}`,
    `لیست‌ها: ${summary.channel_lists}`,
    `ادمین‌ها: ${summary.admins}`,
    "",
    "اگر مطمئن هستید، دکمه تأیید را بزنید.",
  ].join("\n");
}

export function restoreResultText() {
  return "✅ بکاپ با موفقیت بازیابی شد.";
}

function permissionButtonLabel(permissions, key) {
  return `${permissions[key] ? "✅" : "❌"} ${getPermissionLabel(key)}`;
}

function getPermissionLabel(key) {
  return PERMISSIONS.find(([permissionKey]) => permissionKey === key)?.[1] || key;
}

function renderAdminSummary(admin) {
  const lines = [
    `👤 <code>${escapeHtml(String(admin.chat_id))}</code>`,
    admin.display_name ? `نام: <b>${escapeHtml(admin.display_name)}</b>` : null,
    admin.username ? `یوزرنیم: @${escapeHtml(admin.username)}` : null,
    toBool(admin.is_owner) ? "نقش: مالک اصلی" : null,
  ].filter(Boolean);

  const enabledPermissions = PERMISSIONS
    .filter(([key]) => key !== "can_manage_target_channel" || toBool(admin[key]))
    .map(([key, label]) => (toBool(admin[key]) ? `✅ ${label}` : null))
    .filter(Boolean);

  if (enabledPermissions.length) {
    lines.push(`دسترسی‌ها: ${enabledPermissions.join("، ")}`);
  }

  return lines.join("\n");
}

function renderAdminButtonLabel(admin) {
  const label = admin.display_name || admin.username || admin.chat_id;
  return toBool(admin.is_owner) ? `${label} (مالک)` : String(label);
}

function hasProtocolMenuAccess(admin) {
  return isOwner(admin)
    || canViewPermission(admin, "can_manage_protocol_add")
    || canViewPermission(admin, "can_manage_protocol_edit")
    || canViewPermission(admin, "can_manage_protocol_delete");
}

function hasAnyListAccess(admin) {
  return canViewPermission(admin, "can_manage_whitelist") || canViewPermission(admin, "can_manage_blacklist");
}

function hasTargetChannelAccess(admin) {
  return isOwner(admin) || canViewPermission(admin, "can_manage_target_channel");
}

function canViewPermission(admin, key) {
  return isOwner(admin) || toBool(admin?.[key]);
}

function isOwner(admin) {
  return toBool(admin?.is_owner);
}

function toBool(value) {
  return Number(value) === 1 || value === true;
}

function resolveDisplayValue(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function resolveTelegramUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (/^https?:\/\//i.test(text) || /^tg:\/\//i.test(text)) {
    return text;
  }

  if (text.startsWith("@")) {
    return `https://t.me/${text.slice(1)}`;
  }

  return "";
}

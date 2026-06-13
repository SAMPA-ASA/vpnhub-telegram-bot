import { PERMISSIONS } from "./constants.js";

import {
  buildBackupData,
  clearSession,
  deleteAdmin,
  deleteChannelEntry,
  deleteProtocolById,
  ensureBootstrap,
  findChannelEntry,
  getAdmin,
  getEnabledProtocols,
  getSettings,
  getSession,
  listAdmins,
  listChannelLists,
  listProtocols,
  restoreBackupData,
  setSession,
  setSetting,
  touchAdminProfile,
  upsertAdmin,
  upsertChannelEntry,
  upsertProtocol,
  updateProtocolById,
} from "./storage.js";

import {
  buildAdminsListText,
  buildAdminSelectionText,
  buildChannelListText,
  buildMainText,
  buildGuestMainText,
  disclaimerText,
  buildProtocolListText,
  buildStatusText,
  adminKeyboard,
  adminSelectionKeyboard,
  confirmationKeyboard,
  helpText,
  listKeyboard,
  listRootKeyboard,
  listRootText,
  guestMainKeyboard,
  mainKeyboard,
  permissionKeyboard,
  protocolKeyboard,
  protocolMenuText,
  renderPermissionPanel,
  restorePreviewText,
  restorePromptText,
  restoreResultText,
  sessionCancelKeyboard,
  statusKeyboard,
} from "./ui.js";

import {
  buildSourceLabel,
  extractChannelReference,
  extractConfigsFromMessage,
  channelKeysFromChat,
  findProtocolByQuery,
  getEnabledProtocolsForScan,
  isChannelAllowed,
  renderConfigForwardMessage,
  searchProtocols,
} from "./extraction.js";

import {
  answerCallback,
  copyMessage,
  downloadTelegramFile,
  editMessageText,
  sendDocument,
  sendMessage,
} from "./telegram.js";

import { debugLog } from "./debug.js";
import { dateStamp, escapeHtml, getMessageText, normalizeChatId, normalizeTextInput, parsePairInput } from "./utils.js";

export async function handleUpdate(update, env) {
  if (!update || typeof update !== "object") {
    return;
  }

  await ensureBootstrap(env);

  if (update.channel_post) {
    await handleChannelPost(update.channel_post, env);
    return;
  }

  if (update.message) {
    await handleMessage(update.message, env);
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
  }
}

async function handleMessage(message, env) {
  if (!message?.chat || message.chat.type !== "private") {
    return;
  }

  const chatId = String(message.chat.id);
  const admin = await getAdmin(chatId, env);
  await touchAdminProfile(message.chat, env, isOwner(admin));

  const text = normalizeTextInput(getMessageText(message));
  debugLog(env, "info", "private_message.text", { chatId, text });

  if (text === "/disclaimer") {
    await sendMessage(env, chatId, disclaimerText());
    return;
  }

  if (text === "/cancel") {
    const session = await getSession(env, chatId);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ عملیات لغو شد.", await getPreviousMenuForSession(session, admin, env));
    return;
  }

  if (text === "/id") {
    await sendMessage(env, chatId, `🆔 Chat ID شما:\n<code>${escapeHtml(chatId)}</code>`);
    return;
  }

  if (text === "/help") {
    await sendMessage(env, chatId, helpText(), await getMainMenuReplyMarkup(admin, env));
    return;
  }

  if (text === "/start" || text === "/menu") {
    if (text === "/start") {
      await clearSession(env, chatId);
    }

    await showMainMenu(env, chatId, admin);
    return;
  }

  const session = await getSession(env, chatId);
  if (!session) {
    return;
  }

  debugLog(env, "info", "private_message.session", { chatId, state: session.state });

  const data = session.data || {};

  if (session.state === "protocol_add") {
    const pair = parsePairInput(text);
    if (!pair) {
      await sendMessage(
        env,
        chatId,
        "پروتکل را به این شکل بفرستید:\n<code>pattern | type</code>\nمثال:\n<code>myproto:// | MyProtocol</code>",
        sessionCancelKeyboard(),
      );
      return;
    }

    await upsertProtocol(env, chatId, pair.left, pair.right);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ پروتکل ذخیره شد.", protocolKeyboard());
    return;
  }

  if (session.state === "protocol_search") {
    const rows = await searchProtocols(env, text);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, rows.length ? buildProtocolListText(rows) : "نتیجه‌ای پیدا نشد.", protocolKeyboard());
    return;
  }

  if (session.state === "protocol_edit_pick") {
    const protocol = await findProtocolByQuery(env, text);
    if (!protocol) {
      await sendMessage(env, chatId, "پروتکل پیدا نشد.", sessionCancelKeyboard());
      return;
    }

    await setSession(env, chatId, "protocol_edit_value", { id: protocol.id }, 30);
    await sendMessage(
      env,
      chatId,
      `مقدار جدید را بفرستید:\n<code>pattern | type</code>\n\nمقدار فعلی:\n<code>${escapeHtml(protocol.pattern)}</code> → <b>${escapeHtml(protocol.type_name)}</b>`,
      sessionCancelKeyboard(),
    );
    return;
  }

  if (session.state === "protocol_edit_value") {
    const pair = parsePairInput(text);
    if (!pair) {
      await sendMessage(env, chatId, "فرمت درست:\n<code>pattern | type</code>", sessionCancelKeyboard());
      return;
    }

    await updateProtocolById(env, data.id, pair.left, pair.right);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ پروتکل ویرایش شد.", protocolKeyboard());
    return;
  }

  if (session.state === "protocol_delete_pick") {
    const protocol = await findProtocolByQuery(env, text);
    if (!protocol) {
      await sendMessage(env, chatId, "پروتکل پیدا نشد.");
      return;
    }

    await setSession(env, chatId, "confirm_action", { type: "protocol_delete", protocolId: protocol.id }, 30);
    await sendMessage(
      env,
      chatId,
      `آیا مطمئن هستید که می‌خواهید این پروتکل را حذف کنید؟\n<code>${escapeHtml(protocol.pattern)}</code>  <b>${escapeHtml(protocol.type_name)}</b>`,
      confirmationKeyboard("protocol_delete"),
    );
    return;
  }

  if (session.state === "list_add") {
    const reference = extractChannelReference(message);
    if (!reference) {
      await sendMessage(env, chatId, `شناسه کانال را برای لیست ${data.listType === "white" ? "سفید" : "سیاه"} بفرستید.`, sessionCancelKeyboard());
      return;
    }

    await upsertChannelEntry(env, chatId, data.listType, reference);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, `✅ کانال به لیست ${data.listType === "white" ? "سفید" : "سیاه"} اضافه شد.`, listKeyboard(admin, data.listType));
    return;
  }

  if (session.state === "list_remove") {
    const reference = extractChannelReference(message);
    if (!reference) {
      await sendMessage(env, chatId, "این کانال در لیست وجود ندارد.");
      return;
    }

    const entry = await findChannelEntry(env, data.listType, reference.channelKey);
    if (!entry) {
      await sendMessage(env, chatId, "این کانال در لیست وجود ندارد.");
      return;
    }

    await setSession(env, chatId, "confirm_action", {
      type: "list_delete",
      listType: data.listType,
      channelKey: entry.channel_key,
    }, 30);

    await sendMessage(
      env,
      chatId,
      `آیا مطمئن هستید که می‌خواهید این کانال را از لیست ${data.listType === "white" ? "سفید" : "سیاه"} حذف کنید؟\n<code>${escapeHtml(entry.channel_key)}</code>`,
      confirmationKeyboard("list_delete"),
    );
    return;
  }

  if (session.state === "send_message") {
    await setSession(env, chatId, "confirm_action", {
      type: "send_message",
      sourceChatId: chatId,
      sourceMessageId: message.message_id,
    }, 30);

    await sendMessage(
      env,
      chatId,
      "پیام دریافت شد. برای ارسال به کانال مقصد، تأیید نهایی را انجام دهید.",
      confirmationKeyboard("send_message"),
    );
    return;
  }

  if (session.state === "restore_wait_file") {
    try {
      const backup = await parseBackupFromMessage(message, env);
      const summary = summarizeBackup(backup);
      await setSession(env, chatId, "confirm_action", { type: "restore_backup", backup }, 30);
      await sendMessage(env, chatId, restorePreviewText(summary), confirmationKeyboard("restore_backup"));
    } catch (error) {
      await sendMessage(env, chatId, `❌ فایل بکاپ معتبر نیست.\n${escapeHtml(error.message)}`);
    }
    return;
  }

  if (session.state === "target_channel") {
    const reference = extractChannelReference(message);
    if (!reference) {
      await sendMessage(env, chatId, "شناسه کانال معتبر نیست. فقط عدد یا @username بفرستید.");
      return;
    }

    await setSetting(env, "target_channel_id", reference.channelKey);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, `✅ کانال مقصد ثبت شد:\n<code>${escapeHtml(reference.channelKey)}</code>`, await getMainMenuReplyMarkup(admin, env));
    return;
  }

  if (session.state === "admin_add") {
    const targetChatId = normalizeChatId(text);
    if (!targetChatId) {
      await sendMessage(env, chatId, "Chat ID معتبر نیست. فقط عدد Chat ID را بفرستید.");
      return;
    }

    await setSession(env, chatId, "admin_perm", {
      mode: "add",
      targetChatId,
      permissions: blankPermissions(),
    }, 30);

    await sendMessage(env, chatId, renderPermissionPanel(targetChatId, blankPermissions(), "add"), permissionKeyboard(blankPermissions()));
    return;
  }

  if (session.state === "admin_edit") {
    const targetChatId = normalizeChatId(text);
    if (!targetChatId) {
      await sendMessage(env, chatId, "Chat ID معتبر نیست.");
      return;
    }

    const existing = await getAdmin(targetChatId, env);
    if (!existing) {
      await sendMessage(env, chatId, "این ادمین وجود ندارد.");
      return;
    }

    const permissions = permissionsFromAdmin(existing);
    await setSession(env, chatId, "admin_perm", {
      mode: "edit",
      targetChatId,
      permissions,
    }, 30);

    await sendMessage(env, chatId, renderPermissionPanel(targetChatId, permissions, "edit"), permissionKeyboard(permissions));
    return;
  }

  if (session.state === "admin_perm") {
    const permissions = { ...(data.permissions || blankPermissions()) };

    if (text === "/cancel") {
      await clearSession(env, chatId);
      await sendMessage(env, chatId, "✅ عملیات لغو شد.", adminKeyboard());
      return;
    }

    // Message-driven permission edits are handled via callback buttons only.
    return;
  }
}

async function handleCallbackQuery(callbackQuery, env) {
  const chatId = String(callbackQuery?.message?.chat?.id ?? callbackQuery?.from?.id ?? "");
  if (!chatId) {
    return;
  }

  const admin = await getAdmin(chatId, env);
  const data = String(callbackQuery.data || "");
  const [scope, action, extra] = data.split(":");

  const reply = (text, replyMarkup = null, disablePreview = false) =>
    replyToCallback(callbackQuery, env, text, replyMarkup, disablePreview);

  if (scope === "menu") {
    await handleMenuAction(chatId, action, admin, env, reply);
    return;
  }

  if (scope === "toggle") {
    await handleToggle(chatId, action, admin, env, reply);
    return;
  }

  if (scope === "mode") {
    await handleMode(chatId, action, admin, env, reply);
    return;
  }

  if (scope === "act") {
    await handleAction(chatId, action, extra, admin, env, reply);
    return;
  }

  if (scope === "perm") {
    await handlePermission(chatId, action, admin, env, reply);
    return;
  }

  if (scope === "confirm") {
    await handleConfirm(chatId, action, extra, admin, env, reply);
  }
}

async function handleMenuAction(chatId, action, admin, env, reply) {
  if (action === "main") {
    await clearSession(env, chatId);
    const { text, replyMarkup } = await getMainMenuPayload(env, admin);
    await reply(text, replyMarkup);
    return;
  }

  if (action === "status") {
    await clearSession(env, chatId);
    const settings = await getSettings(env);
    const targetChannel = resolveTargetChannelId(settings, env);
    await reply(buildStatusText(settings, targetChannel), statusKeyboard(settings.copy_mode, admin));
    return;
  }

  if (action === "protocols") {
    await clearSession(env, chatId);
    await reply(protocolMenuText(), protocolKeyboard());
    return;
  }

  if (action === "lists") {
    await clearSession(env, chatId);
    await reply(listRootText(), listRootKeyboard(admin));
    return;
  }

  if (action === "white_list" || action === "black_list") {
    await clearSession(env, chatId);
    const listType = action.startsWith("white") ? "white" : "black";
    const rows = await listChannelLists(env, listType);
    await reply(buildChannelListText(listType, rows), listKeyboard(admin, listType));
    return;
  }

  if (action === "admins") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    await clearSession(env, chatId);
    await reply("مدیریت ادمین‌ها:", adminKeyboard());
  }
}

async function handleToggle(chatId, action, admin, env, reply) {
  if (action !== "bot") {
    return;
  }

  if (!can(admin, "can_toggle_bot")) {
    await reply("❌ دسترسی ندارید.");
    return;
  }

  const settings = await getSettings(env);
  const next = settings.enabled === "1" ? "0" : "1";
  await setSetting(env, "enabled", next);

  const updated = await getSettings(env);
  const targetChannel = resolveTargetChannelId(updated, env);
  await reply(
    buildStatusText(updated, targetChannel),
    statusKeyboard(updated.copy_mode, admin),
  );
}

async function handleMode(chatId, action, admin, env, reply) {
  if (action !== "black" && action !== "white") {
    return;
  }

  if (!can(admin, "can_manage_mode")) {
    await reply("❌ دسترسی ندارید.");
    return;
  }

  await setSetting(env, "copy_mode", action);

  const settings = await getSettings(env);
  const targetChannel = resolveTargetChannelId(settings, env);
  await reply(
    buildStatusText(settings, targetChannel),
    statusKeyboard(settings.copy_mode, admin),
  );
}

async function handleAction(chatId, action, extra, admin, env, reply) {
  if (action !== "cancel_edit") {
    await clearSession(env, chatId);
  }

  if (action === "cancel_edit") {
    const session = await getSession(env, chatId);
    await clearSession(env, chatId);
    await reply("✅ عملیات لغو شد.", await getPreviousMenuForSession(session, admin, env));
    return;
  }

  if (action === "protocol_add") {
    if (!can(admin, "can_manage_protocol_add")) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await setSession(env, chatId, "protocol_add", {}, 30);
    await reply(
      "پروتکل را به این شکل بفرستید:\n<code>pattern | type</code>\nمثال:\n<code>myproto:// | MyProtocol</code>",
      sessionCancelKeyboard(),
    );
    return;
  }

  if (action === "protocol_search") {
    await setSession(env, chatId, "protocol_search", {}, 30);
    await reply("عبارت جستجو را بفرستید.", sessionCancelKeyboard());
    return;
  }

  if (action === "protocol_list") {
    const protocols = await listProtocols(env);
    await reply(buildProtocolListText(protocols), protocolKeyboard());
    return;
  }

  if (action === "protocol_edit") {
    if (!can(admin, "can_manage_protocol_edit")) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await setSession(env, chatId, "protocol_edit_pick", {}, 30);
    await reply("شناسه یا الگوی پروتکل موردنظر را برای ویرایش بفرستید.", sessionCancelKeyboard());
    return;
  }

  if (action === "protocol_delete") {
    if (!can(admin, "can_manage_protocol_delete")) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await setSession(env, chatId, "protocol_delete_pick", {}, 30);
    await reply("شناسه یا الگوی پروتکل موردنظر را برای حذف بفرستید.", sessionCancelKeyboard());
    return;
  }

  if (action === "white_add" || action === "black_add") {
    const listType = action.startsWith("white") ? "white" : "black";
    if (!can(admin, listType === "white" ? "can_manage_whitelist" : "can_manage_blacklist")) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await setSession(env, chatId, "list_add", { listType }, 30);
    await reply(`شناسه کانال را برای لیست ${listType === "white" ? "سفید" : "سیاه"} بفرستید.`, sessionCancelKeyboard());
    return;
  }

  if (action === "white_remove" || action === "black_remove") {
    const listType = action.startsWith("white") ? "white" : "black";
    if (!can(admin, listType === "white" ? "can_manage_whitelist" : "can_manage_blacklist")) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await setSession(env, chatId, "list_remove", { listType }, 30);
    await reply(`شناسه کانال را برای حذف از لیست ${listType === "white" ? "سفید" : "سیاه"} بفرستید.`, sessionCancelKeyboard());
    return;
  }

  if (action === "send_message") {
    if (!(isOwner(admin) || toBool(admin.can_manage_target_channel))) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await setSession(env, chatId, "send_message", {}, 30);
    await reply("پیام، عکس یا ویدئو را بفرستید. بعد از دریافت، تأیید نهایی گرفته می‌شود.", sessionCancelKeyboard());
    return;
  }

  if (action === "restore_backup") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند بکاپ را بازیابی کند.");
      return;
    }

    await setSession(env, chatId, "restore_wait_file", {}, 30);
    await reply(restorePromptText(), sessionCancelKeyboard());
    return;
  }

  if (action === "target_channel") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    await setSession(env, chatId, "target_channel", {}, 30);
    await reply("شناسه کانال مقصد را بفرستید...", sessionCancelKeyboard());
    return;
  }

  if (action === "admins_add") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    await setSession(env, chatId, "admin_add", {}, 30);
    await reply("Chat ID کاربر را بفرستید...", sessionCancelKeyboard());
    return;
  }

  if (action === "admins_list") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    const admins = await listAdmins(env);
    await reply(buildAdminsListText(admins), adminKeyboard());
    return;
  }

  if (action === "admins_edit") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    const admins = await listAdmins(env);
    await reply(buildAdminSelectionText(admins), adminSelectionKeyboard(admins, chatId, "admins_edit_pick"));
    return;
  }

  if (action === "admins_remove") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    const admins = await listAdmins(env);
    await reply(buildAdminSelectionText(admins), adminSelectionKeyboard(admins, chatId, "admins_remove_pick"));
    return;
  }

  if (action === "backup") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    const backup = await buildBackupData(env);
    await sendDocument(env, chatId, `vpnhub-backup-${dateStamp()}.json`, JSON.stringify(backup, null, 2), "✅ فایل بکاپ آماده شد.");
    return;
  }

  if (action === "admins_edit_pick" || action === "admins_remove_pick") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    const targetChatId = normalizeChatId(extra);
    if (!targetChatId) {
      await reply("Chat ID معتبر نیست.");
      return;
    }

    const existing = await getAdmin(targetChatId, env);
    if (!existing) {
      await reply("این ادمین وجود ندارد.");
      return;
    }

    if (action === "admins_edit_pick") {
      const permissions = permissionsFromAdmin(existing);
      await setSession(env, chatId, "admin_perm", {
        mode: "edit",
        targetChatId,
        permissions,
      }, 30);
      await reply(renderPermissionPanel(targetChatId, permissions, "edit"), permissionKeyboard(permissions));
      return;
    }

    if (toBool(existing.is_owner)) {
      await reply("مالک اصلی را نمی‌توان حذف کرد.");
      return;
    }

    await setSession(env, chatId, "confirm_action", { type: "admin_delete", targetChatId }, 30);
    await reply(`آیا مطمئن هستید که می‌خواهید این ادمین را حذف کنید؟\n<code>${escapeHtml(targetChatId)}</code>`, confirmationKeyboard("admin_delete"));
  }
}

async function handlePermission(chatId, action, admin, env, reply) {
  const session = await getSession(env, chatId);
  if (!session || session.state !== "admin_perm") {
    return;
  }

  const data = session.data || {};
  let permissions = { ...(data.permissions || blankPermissions()) };

  if (action === "cancel") {
    await clearSession(env, chatId);
    await reply("✅ عملیات لغو شد.", await getPreviousMenuForSession(session, admin, env));
    return;
  }

  if (action === "all") {
    for (const [key] of PERMISSIONS) {
      permissions[key] = true;
    }
  } else if (action === "none") {
    for (const [key] of PERMISSIONS) {
      permissions[key] = false;
    }
  } else if (action === "save") {
    await upsertAdmin(env, data.targetChatId, permissions);
    await clearSession(env, chatId);
    await reply("✅ ادمین ذخیره شد.", adminKeyboard());
    return;
  } else if (action.startsWith("toggle_")) {
    const key = action.replace("toggle_", "");
    if (key in permissions) {
      permissions[key] = !permissions[key];
    }
  } else {
    return;
  }

  await setSession(env, chatId, "admin_perm", { ...data, permissions }, 30);
  await reply(renderPermissionPanel(data.targetChatId, permissions, data.mode), permissionKeyboard(permissions));
}

async function handleConfirm(chatId, action, extra, admin, env, reply) {
  const session = await getSession(env, chatId);
  if (!session || session.state !== "confirm_action") {
    return;
  }

  const data = session.data || {};
  if (extra === "no") {
    await clearSession(env, chatId);
    await reply("✅ عملیات لغو شد.", await getPreviousMenuForConfirm(data, admin, env));
    return;
  }

  if (action === "protocol_delete") {
    if (!can(admin, "can_manage_protocol_delete")) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await deleteProtocolById(env, data.protocolId);
    await clearSession(env, chatId);
    await reply("✅ پروتکل حذف شد.", protocolKeyboard());
    return;
  }

  if (action === "list_delete") {
    if (!can(admin, data.listType === "white" ? "can_manage_whitelist" : "can_manage_blacklist")) {
      await reply("❌ دسترسی ندارید.");
      return;
    }

    await deleteChannelEntry(env, data.listType, data.channelKey);
    await clearSession(env, chatId);
    await reply(`✅ کانال از لیست ${data.listType === "white" ? "سفید" : "سیاه"} حذف شد.`, listKeyboard(admin, data.listType));
    return;
  }

  if (action === "send_message") {
    const settings = await getSettings(env);
    const targetChannel = resolveTargetChannelId(settings, env);
    await copyMessage(env, data.sourceChatId, data.sourceMessageId, targetChannel);
    await clearSession(env, chatId);
    await reply("✅ پیام ارسال شد.", await getMainMenuReplyMarkup(admin, env));
    return;
  }

  if (action === "restore_backup") {
    await restoreBackupData(env, data.backup);
    await clearSession(env, chatId);
    await reply(restoreResultText(), await getMainMenuReplyMarkup(admin, env));
    return;
  }

  if (action === "admin_delete") {
    if (!isOwner(admin)) {
      await reply("❌ فقط مالک اصلی می‌تواند این بخش را ببیند.");
      return;
    }

    await deleteAdmin(env, data.targetChatId);
    await clearSession(env, chatId);
    await reply("✅ ادمین حذف شد.", adminKeyboard());
  }
}

async function handleChannelPost(message, env) {
  const settings = await getSettings(env);
  if (settings.enabled !== "1") {
    return;
  }

  const targetChannelId = resolveTargetChannelId(settings, env);
  if (!targetChannelId) {
    return;
  }

  if (isTargetChannelPost(message.chat, targetChannelId)) {
    return;
  }

  if (!(await isChannelAllowed(env, message.chat, settings.copy_mode))) {
    return;
  }

  const protocols = await getEnabledProtocolsForScan(env);
  const configs = extractConfigsFromMessage(message, protocols);
  if (!configs.length) {
    return;
  }

  const sourceLabel = buildSourceLabel(message.chat);
  for (const config of configs) {
    await sendMessage(env, targetChannelId, renderConfigForwardMessage(sourceLabel, config), null, true);
  }
}

async function showMainMenu(env, chatId, admin) {
  const { text, replyMarkup } = await getMainMenuPayload(env, admin);
  await sendMessage(env, chatId, text, replyMarkup);
}

async function getMainMenuPayload(env, admin) {
  const settings = await getSettings(env);
  if (admin) {
    const targetChannel = resolveTargetChannelId(settings, env);
    return {
      text: buildMainText(settings, targetChannel),
      replyMarkup: mainKeyboard(admin),
    };
  }

  return {
    text: buildGuestMainText(settings, env),
    replyMarkup: guestMainKeyboard(settings, env),
  };
}

async function getMainMenuReplyMarkup(admin, env) {
  if (admin) {
    return mainKeyboard(admin);
  }

  const settings = await getSettings(env);
  return guestMainKeyboard(settings, env);
}

async function getPreviousMenuForSession(session, admin, env) {
  if (!session) {
    return getMainMenuReplyMarkup(admin, env);
  }

  if (session.state === "protocol_add"
    || session.state === "protocol_search"
    || session.state === "protocol_edit_pick"
    || session.state === "protocol_edit_value"
    || session.state === "protocol_delete_pick") {
    return protocolKeyboard();
  }

  if (session.state === "list_add" || session.state === "list_remove") {
    return listKeyboard(admin, session.data?.listType);
  }

  if (session.state === "send_message" || session.state === "restore_wait_file" || session.state === "target_channel") {
    return getMainMenuReplyMarkup(admin, env);
  }

  if (session.state === "admin_add" || session.state === "admin_edit" || session.state === "admin_perm") {
    return adminKeyboard();
  }

  if (session.state === "confirm_action") {
    return getPreviousMenuForConfirm(session.data || {}, admin, env);
  }

  return getMainMenuReplyMarkup(admin, env);
}

async function getPreviousMenuForConfirm(data, admin, env) {
  if (data?.type === "protocol_delete") {
    return protocolKeyboard();
  }

  if (data?.type === "list_delete") {
    return listKeyboard(admin, data.listType);
  }

  if (data?.type === "send_message" || data?.type === "restore_backup") {
    return getMainMenuReplyMarkup(admin, env);
  }

  if (data?.type === "admin_delete") {
    return adminKeyboard();
  }

  return getMainMenuReplyMarkup(admin, env);
}

async function replyToCallback(callbackQuery, env, text, replyMarkup = null, disablePreview = false) {
  try {
    await answerCallback(env, callbackQuery.id);
  } catch {
    // ignore callback ack failures
  }

  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;

  if (chatId && messageId) {
    return editMessageText(env, chatId, messageId, text, replyMarkup, disablePreview);
  }

  return sendMessage(env, chatId || callbackQuery.from?.id, text, replyMarkup, disablePreview);
}

function blankPermissions() {
  return Object.fromEntries(PERMISSIONS.map(([key]) => [key, false]));
}

function permissionsFromAdmin(admin) {
  return Object.fromEntries(PERMISSIONS.map(([key]) => [key, toBool(admin?.[key])]));
}

function can(admin, key) {
  return isOwner(admin) || toBool(admin?.[key]);
}

function isOwner(admin) {
  return toBool(admin?.is_owner);
}

function toBool(value) {
  return Number(value) === 1 || value === true;
}

function resolveTargetChannelId(settings, env) {
  return String(settings?.target_channel_id || env?.TARGET_CHANNEL_ID || "").trim();
}

function isTargetChannelPost(chat, targetChannelId) {
  const normalizedTarget = normalizeChannelKey(targetChannelId);
  if (!normalizedTarget || !chat) {
    return false;
  }

  return channelKeysFromChat(chat).some((key) => normalizeChannelKey(key) === normalizedTarget);
}

function normalizeChannelKey(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  return text.startsWith("@") ? text.toLowerCase() : text;
}

async function parseBackupFromMessage(message, env) {
  if (message?.document?.file_id) {
    const fileText = await downloadTelegramFile(env, message.document.file_id);
    return JSON.parse(fileText);
  }

  const text = normalizeTextInput(getMessageText(message));
  if (!text) {
    throw new Error("فایل JSON ارسال نشده است");
  }

  return JSON.parse(text);
}

function summarizeBackup(backup) {
  return {
    settings: Array.isArray(backup.settings) ? backup.settings.length : 0,
    protocols: Array.isArray(backup.protocols) ? backup.protocols.length : 0,
    channel_lists: Array.isArray(backup.channel_lists) ? backup.channel_lists.length : 0,
    admins: Array.isArray(backup.admins) ? backup.admins.length : 0,
  };
}

import assert from "node:assert/strict";

import worker from "../src/index.js";
import { createMockEnv } from "../test-support/mock-d1.js";
import { installTelegramMock } from "../test-support/telegram-mock.js";

export const tests = [
  {
    name: "serves health and webhook routes correctly",
    fn: async () => {
      const env = createMockEnv({
        OWNER_CHAT_ID: "111",
        TARGET_CHANNEL_ID: "@destination",
      });
      const telegramMock = installTelegramMock();

      try {
        const healthResponse = await worker.fetch(new Request("https://example.com/health"), env);
        assert.equal(healthResponse.status, 200);
        assert.equal(await healthResponse.text(), "ok");

        const wrongSecretResponse = await worker.fetch(
          new Request("https://example.com/webhook/wrong-secret"),
          env,
        );
        assert.equal(wrongSecretResponse.status, 404);

        const methodResponse = await worker.fetch(
          new Request("https://example.com/webhook/secret"),
          env,
        );
        assert.equal(methodResponse.status, 405);

        const updateResponse = await worker.fetch(
          new Request("https://example.com/webhook/secret", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              channel_post: {
                message_id: 42,
                chat: {
                  id: -100222,
                  type: "channel",
                  username: "source_channel",
                  title: "Source Channel",
                },
                text: "new config vless://abc123",
              },
            }),
          }),
          env,
        );

        assert.equal(updateResponse.status, 200);
        assert.equal(await updateResponse.text(), "ok");

        const sendMessageCall = telegramMock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);
        assert.ok(String(sendMessageCall.init.body).includes("@destination"));
        assert.ok(String(sendMessageCall.init.body).includes("vless://abc123"));
      } finally {
        telegramMock.restore();
      }
    },
  },
  {
    name: "returns debug logs when debug mode is enabled",
    fn: async () => {
      const env = createMockEnv({
        OWNER_CHAT_ID: "111",
        TARGET_CHANNEL_ID: "@destination",
        DEBUG: "1",
        CF_VERSION_METADATA: {
          id: "test-deployment-id",
          tag: "test-tag",
          timestamp: "2026-06-09T00:00:00.000Z",
        },
      });
      const telegramMock = installTelegramMock();

      try {
        const response = await worker.fetch(
          new Request("https://example.com/webhook/secret", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              channel_post: {
                message_id: 42,
                chat: {
                  id: -100222,
                  type: "channel",
                  username: "source_channel",
                  title: "Source Channel",
                },
                text: "new config vless://abc123",
              },
            }),
          }),
          env,
        );

        assert.equal(response.status, 200);

        const payload = JSON.parse(await response.text());
        assert.equal(payload.ok, true);
        assert.ok(Array.isArray(payload.logs));
        assert.ok(payload.logs.some((entry) => entry.event === "telegram.request"));
        assert.ok(payload.logs.some((entry) => entry.event === "request.update"));
        assert.equal(payload.deploymentId, "test-deployment-id");
        assert.equal(payload.body, "ok");

        const sendMessageCall = telegramMock.calls.find((call) => call.url.includes("/sendMessage"));
        assert.ok(sendMessageCall);
      } finally {
        telegramMock.restore();
      }
    },
  },
];

import assert from "node:assert/strict";

import {
  buildSourceLabel,
  extractChannelReference,
  extractConfigsFromMessage,
  renderConfigForwardMessage,
} from "../src/extraction.js";

export const tests = [
  {
    name: "extracts configs from message text and button urls",
    fn: async () => {
      const protocols = [
        { pattern: "vless://", type_name: "VLESS" },
        { pattern: "stormdns://", type_name: "StormDNS" },
      ];

      const message = {
        text: "first link vless://abc123 and second link inside button",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "open",
                url: "https://example.com/?next=stormdns://demo-987",
              },
            ],
          ],
        },
      };

      const configs = extractConfigsFromMessage(message, protocols);
      assert.equal(configs.length, 2);
      assert.deepEqual(
        configs.map((item) => item.protocolType).sort(),
        ["StormDNS", "VLESS"],
      );
      assert.ok(configs.some((item) => item.url.startsWith("vless://")));
      assert.ok(configs.some((item) => item.url.startsWith("stormdns://")));
    },
  },
  {
    name: "does not treat vless links as ss configs",
    fn: async () => {
      const protocols = [
        { pattern: "vless://", type_name: "VLESS" },
        { pattern: "ss://", type_name: "Shadowsocks" },
      ];

      const message = {
        text: "config vless://abc123",
      };

      const configs = extractConfigsFromMessage(message, protocols);
      assert.equal(configs.length, 1);
      assert.equal(configs[0].protocolType, "VLESS");
      assert.equal(configs[0].url, "vless://abc123");
    },
  },
  {
    name: "extracts channel references from forwarded messages and usernames",
    fn: async () => {
      const forwarded = extractChannelReference({
        forward_from_chat: {
          type: "channel",
          id: -100123,
          title: "News",
          username: "news",
        },
      });

      const username = extractChannelReference({
        text: "@my_telegram_channel",
      });

      assert.deepEqual(forwarded, {
        channelKey: "-100123",
        channelUsername: "news",
        channelTitle: "News",
      });

      assert.deepEqual(username, {
        channelKey: "@my_telegram_channel",
        channelUsername: "my_telegram_channel",
        channelTitle: null,
      });
    },
  },
  {
    name: "renders forwarded config messages with source and type",
    fn: async () => {
      const text = renderConfigForwardMessage(buildSourceLabel({ username: "source" }), {
        protocolType: "VLESS",
        url: "vless://abc",
      });

      assert.match(text, /@source/);
      assert.match(text, /VLESS/);
      assert.match(text, /vless:\/\/abc/);
    },
  },
];

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDiscordEmojiCacheForTest,
  forgetDiscordGuildEmojis,
  hasDiscordGuildEmojiCache,
  lookupDiscordGuildEmoji,
  rememberDiscordGuildEmojis,
} from "./emoji-cache.js";

describe("discord emoji cache", () => {
  beforeEach(() => {
    __resetDiscordEmojiCacheForTest();
  });

  it("remembers emojis keyed by accountId + guildId", () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [
        { id: "111", name: "foo", animated: false },
        { id: "222", name: "bar", animated: true },
      ],
    });
    expect(lookupDiscordGuildEmoji({ accountId: "default", guildId: "G1", name: "foo" })).toEqual({
      id: "111",
      animated: false,
    });
    expect(lookupDiscordGuildEmoji({ accountId: "default", guildId: "G1", name: "bar" })).toEqual({
      id: "222",
      animated: true,
    });
  });

  it("returns undefined for unknown emoji names", () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [{ id: "111", name: "foo", animated: false }],
    });
    expect(
      lookupDiscordGuildEmoji({ accountId: "default", guildId: "G1", name: "nope" }),
    ).toBeUndefined();
  });

  it("scopes per (accountId, guildId)", () => {
    rememberDiscordGuildEmojis({
      accountId: "ops",
      guildId: "G1",
      emojis: [{ id: "111", name: "foo", animated: false }],
    });
    expect(
      lookupDiscordGuildEmoji({ accountId: "default", guildId: "G1", name: "foo" }),
    ).toBeUndefined();
    expect(
      lookupDiscordGuildEmoji({ accountId: "ops", guildId: "G2", name: "foo" }),
    ).toBeUndefined();
    expect(lookupDiscordGuildEmoji({ accountId: "ops", guildId: "G1", name: "foo" })).toEqual({
      id: "111",
      animated: false,
    });
  });

  it("ignores emojis without an id or name", () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [
        { id: null, name: "skipme", animated: false },
        { id: "111", name: null, animated: false },
        { id: "222", name: "ok", animated: false },
      ],
    });
    expect(
      lookupDiscordGuildEmoji({ accountId: "default", guildId: "G1", name: "skipme" }),
    ).toBeUndefined();
    expect(lookupDiscordGuildEmoji({ accountId: "default", guildId: "G1", name: "ok" })).toEqual({
      id: "222",
      animated: false,
    });
  });

  it("hasDiscordGuildEmojiCache reports whether a fetch has happened", () => {
    expect(hasDiscordGuildEmojiCache({ accountId: "default", guildId: "G1" })).toBe(false);
    rememberDiscordGuildEmojis({ accountId: "default", guildId: "G1", emojis: [] });
    expect(hasDiscordGuildEmojiCache({ accountId: "default", guildId: "G1" })).toBe(true);
  });

  it("forgetDiscordGuildEmojis clears a single (account, guild) bucket", () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [{ id: "111", name: "foo", animated: false }],
    });
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G2",
      emojis: [{ id: "222", name: "bar", animated: false }],
    });
    forgetDiscordGuildEmojis({ accountId: "default", guildId: "G1" });
    expect(hasDiscordGuildEmojiCache({ accountId: "default", guildId: "G1" })).toBe(false);
    expect(lookupDiscordGuildEmoji({ accountId: "default", guildId: "G2", name: "bar" })).toEqual({
      id: "222",
      animated: false,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiscordDirectoryCacheForTest,
  rememberDiscordDirectoryUser,
} from "./directory-cache.js";
import { __resetDiscordEmojiCacheForTest, rememberDiscordGuildEmojis } from "./emoji-cache.js";
import {
  buildAllowedMentionsForContent,
  extractDiscordMentionTargets,
  formatMention,
  rewriteDiscordKnownMentions,
  rewriteDiscordShortcodeEmojis,
} from "./mentions.js";

describe("formatMention", () => {
  it("formats user mentions from ids", () => {
    expect(formatMention({ userId: "123456789" })).toBe("<@123456789>");
  });

  it("formats role mentions from ids", () => {
    expect(formatMention({ roleId: "987654321" })).toBe("<@&987654321>");
  });

  it("formats channel mentions from ids", () => {
    expect(formatMention({ channelId: "777555333" })).toBe("<#777555333>");
  });

  it("throws when no mention id is provided", () => {
    expect(() => formatMention({})).toThrow(/exactly one/i);
  });

  it("throws when more than one mention id is provided", () => {
    expect(() => formatMention({ userId: "1", roleId: "2" })).toThrow(/exactly one/i);
  });
});

describe("rewriteDiscordKnownMentions", () => {
  beforeEach(() => {
    __resetDiscordDirectoryCacheForTest();
  });

  it("rewrites @name mentions when a cached user id exists", () => {
    rememberDiscordDirectoryUser({
      accountId: "default",
      userId: "123456789",
      handles: ["Alice", "@alice_user", "alice#1234"],
    });
    const rewritten = rewriteDiscordKnownMentions("ping @Alice and @alice_user", {
      accountId: "default",
    });
    expect(rewritten).toBe("ping <@123456789> and <@123456789>");
  });

  it("preserves unknown mentions and reserved mentions", () => {
    rememberDiscordDirectoryUser({
      accountId: "default",
      userId: "123456789",
      handles: ["alice"],
    });
    const rewritten = rewriteDiscordKnownMentions("hello @unknown @everyone @here", {
      accountId: "default",
    });
    expect(rewritten).toBe("hello @unknown @everyone @here");
  });

  it("does not rewrite mentions inside markdown code spans", () => {
    rememberDiscordDirectoryUser({
      accountId: "default",
      userId: "123456789",
      handles: ["alice"],
    });
    const rewritten = rewriteDiscordKnownMentions(
      "inline `@alice` fence ```\n@alice\n``` text @alice",
      {
        accountId: "default",
      },
    );
    expect(rewritten).toBe("inline `@alice` fence ```\n@alice\n``` text <@123456789>");
  });

  it("is account-scoped", () => {
    rememberDiscordDirectoryUser({
      accountId: "ops",
      userId: "999888777",
      handles: ["alice"],
    });
    const defaultRewrite = rewriteDiscordKnownMentions("@alice", { accountId: "default" });
    const opsRewrite = rewriteDiscordKnownMentions("@alice", { accountId: "ops" });
    expect(defaultRewrite).toBe("@alice");
    expect(opsRewrite).toBe("<@999888777>");
  });
});

describe("extractDiscordMentionTargets", () => {
  it("extracts unique user mention ids from <@id> syntax", () => {
    expect(extractDiscordMentionTargets("hi <@1234> and <@5678> and <@1234>")).toEqual({
      users: ["1234", "5678"],
      roles: [],
    });
  });

  it("extracts role mention ids from <@&id> syntax", () => {
    expect(extractDiscordMentionTargets("ping <@&111> and <@&222>")).toEqual({
      users: [],
      roles: ["111", "222"],
    });
  });

  it("supports the <@!id> nickname mention form", () => {
    expect(extractDiscordMentionTargets("hi <@!9999>")).toEqual({
      users: ["9999"],
      roles: [],
    });
  });

  it("returns empty arrays for content without mentions", () => {
    expect(extractDiscordMentionTargets("just a plain message")).toEqual({
      users: [],
      roles: [],
    });
  });
});

describe("rewriteDiscordShortcodeEmojis", () => {
  beforeEach(() => {
    __resetDiscordEmojiCacheForTest();
  });

  it("rewrites :name: to <:name:id> when the cached emoji is static", async () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [{ id: "111", name: "peepoBatman_funny", animated: false }],
    });
    const fetchEmojis = vi.fn();
    const result = await rewriteDiscordShortcodeEmojis("hi :peepoBatman_funny: there", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis,
    });
    expect(result).toBe("hi <:peepoBatman_funny:111> there");
    expect(fetchEmojis).not.toHaveBeenCalled();
  });

  it("rewrites :name: to <a:name:id> when the cached emoji is animated", async () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [{ id: "222", name: "wave", animated: true }],
    });
    const result = await rewriteDiscordShortcodeEmojis("hi :wave:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis: vi.fn(),
    });
    expect(result).toBe("hi <a:wave:222>");
  });

  it("leaves unknown :shortcodes: unchanged", async () => {
    const fetchEmojis = vi.fn(async () => []);
    const result = await rewriteDiscordShortcodeEmojis("hello :unknown_emoji:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis,
    });
    expect(result).toBe("hello :unknown_emoji:");
  });

  it("does not rewrite shortcodes inside markdown code spans or fences", async () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [{ id: "111", name: "foo", animated: false }],
    });
    const result = await rewriteDiscordShortcodeEmojis(
      "inline `:foo:` fence ```\n:foo:\n``` and :foo:",
      { accountId: "default", guildId: "G1", fetchEmojis: vi.fn() },
    );
    expect(result).toBe("inline `:foo:` fence ```\n:foo:\n``` and <:foo:111>");
  });

  it("returns text unchanged and skips fetch when guildId is missing", async () => {
    const fetchEmojis = vi.fn();
    const result = await rewriteDiscordShortcodeEmojis("hi :foo:", {
      accountId: "default",
      guildId: undefined,
      fetchEmojis,
    });
    expect(result).toBe("hi :foo:");
    expect(fetchEmojis).not.toHaveBeenCalled();
  });

  it("calls fetchEmojis at most once when the cache is cold", async () => {
    const fetchEmojis = vi.fn(async () => [
      { id: "111", name: "foo", animated: false },
      { id: "222", name: "bar", animated: false },
    ]);
    const result = await rewriteDiscordShortcodeEmojis("hi :foo: and :bar: and :baz:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis,
    });
    expect(result).toBe("hi <:foo:111> and <:bar:222> and :baz:");
    expect(fetchEmojis).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when shortcodes are present after a previous miss", async () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [],
    });
    const fetchEmojis = vi.fn(async () => []);
    const result = await rewriteDiscordShortcodeEmojis("hi :nope:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis,
    });
    expect(result).toBe("hi :nope:");
    expect(fetchEmojis).not.toHaveBeenCalled();
  });

  it("ignores shortcodes that look like clock times or short tokens", async () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [],
    });
    const result = await rewriteDiscordShortcodeEmojis("see http://example.com and 2:30 and :a:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis: vi.fn(),
    });
    expect(result).toBe("see http://example.com and 2:30 and :a:");
  });

  it("returns text unchanged when no `:` characters are present", async () => {
    const fetchEmojis = vi.fn();
    const result = await rewriteDiscordShortcodeEmojis("plain message", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis,
    });
    expect(result).toBe("plain message");
    expect(fetchEmojis).not.toHaveBeenCalled();
  });

  it("does not rewrite shortcodes inside existing <:name:id> emoji tokens", async () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [{ id: "111", name: "foo", animated: false }],
    });
    const result = await rewriteDiscordShortcodeEmojis("keep <:foo:123> intact and rewrite :foo:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis: vi.fn(),
    });
    expect(result).toBe("keep <:foo:123> intact and rewrite <:foo:111>");
  });

  it("does not rewrite shortcodes inside existing <a:name:id> animated tokens", async () => {
    rememberDiscordGuildEmojis({
      accountId: "default",
      guildId: "G1",
      emojis: [{ id: "111", name: "wave", animated: true }],
    });
    const result = await rewriteDiscordShortcodeEmojis("hi <a:wave:999> bye", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis: vi.fn(),
    });
    expect(result).toBe("hi <a:wave:999> bye");
  });

  it("leaves the cache cold when fetchEmojis throws so the next call can retry", async () => {
    const fetchEmojis = vi
      .fn<() => Promise<Array<{ id: string; name: string; animated?: boolean }>>>()
      .mockRejectedValueOnce(new Error("transient network error"))
      .mockResolvedValueOnce([{ id: "111", name: "foo", animated: false }]);
    const first = await rewriteDiscordShortcodeEmojis("hi :foo:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis,
    });
    expect(first).toBe("hi :foo:");
    const second = await rewriteDiscordShortcodeEmojis("hi :foo:", {
      accountId: "default",
      guildId: "G1",
      fetchEmojis,
    });
    expect(second).toBe("hi <:foo:111>");
    expect(fetchEmojis).toHaveBeenCalledTimes(2);
  });
});

describe("buildAllowedMentionsForContent", () => {
  it("returns undefined when content has no mentions", () => {
    expect(buildAllowedMentionsForContent("plain text")).toBeUndefined();
  });

  it("whitelists the exact user ids found in content", () => {
    expect(buildAllowedMentionsForContent("ping <@1234>")).toEqual({
      parse: [],
      users: ["1234"],
      roles: [],
    });
  });

  it("whitelists role ids alongside users", () => {
    expect(buildAllowedMentionsForContent("ping <@1234> and <@&777>")).toEqual({
      parse: [],
      users: ["1234"],
      roles: ["777"],
    });
  });
});

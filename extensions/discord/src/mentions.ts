import type { APIAllowedMentions } from "discord-api-types/v10";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
  normalizeOptionalStringifiedId,
} from "openclaw/plugin-sdk/text-runtime";
import { resolveDiscordDirectoryUserId } from "./directory-cache.js";
import {
  hasDiscordGuildEmojiCache,
  lookupDiscordGuildEmoji,
  rememberDiscordGuildEmojis,
  type DiscordEmojiInput,
} from "./emoji-cache.js";

const MARKDOWN_CODE_SEGMENT_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;
const MENTION_CANDIDATE_PATTERN = /(^|[\s([{"'.,;:!?])@([a-z0-9_.-]{2,32}(?:#[0-9]{4})?)/gi;
const DISCORD_RESERVED_MENTIONS = new Set(["everyone", "here"]);
const USER_MENTION_TOKEN_PATTERN = /<@!?(\d+)>/g;
const ROLE_MENTION_TOKEN_PATTERN = /<@&(\d+)>/g;
const SHORTCODE_EMOJI_TOKEN_PATTERN = /:([A-Za-z0-9_]{2,32}):/g;
const DISCORD_EMOJI_LITERAL_PATTERN = /<a?:[A-Za-z0-9_]{2,32}:\d+>/g;

function normalizeSnowflake(value: string | number | bigint): string | null {
  const text = normalizeOptionalStringifiedId(value) ?? "";
  if (!/^\d+$/.test(text)) {
    return null;
  }
  return text;
}

export function formatMention(params: {
  userId?: string | number | bigint | null;
  roleId?: string | number | bigint | null;
  channelId?: string | number | bigint | null;
}): string {
  const userId = params.userId == null ? null : normalizeSnowflake(params.userId);
  const roleId = params.roleId == null ? null : normalizeSnowflake(params.roleId);
  const channelId = params.channelId == null ? null : normalizeSnowflake(params.channelId);
  const values = [
    userId ? { kind: "user" as const, id: userId } : null,
    roleId ? { kind: "role" as const, id: roleId } : null,
    channelId ? { kind: "channel" as const, id: channelId } : null,
  ].filter((entry): entry is { kind: "user" | "role" | "channel"; id: string } => Boolean(entry));
  if (values.length !== 1) {
    throw new Error("formatMention requires exactly one of userId, roleId, or channelId");
  }
  const target = values[0];
  if (target.kind === "user") {
    return `<@${target.id}>`;
  }
  if (target.kind === "role") {
    return `<@&${target.id}>`;
  }
  return `<#${target.id}>`;
}

function rewritePlainTextMentions(text: string, accountId?: string | null): string {
  if (!text.includes("@")) {
    return text;
  }
  return text.replace(MENTION_CANDIDATE_PATTERN, (match, prefix, rawHandle) => {
    const handle = normalizeOptionalString(rawHandle) ?? "";
    if (!handle) {
      return match;
    }
    const lookup = normalizeLowercaseStringOrEmpty(handle);
    if (DISCORD_RESERVED_MENTIONS.has(lookup)) {
      return match;
    }
    const userId = resolveDiscordDirectoryUserId({
      accountId,
      handle,
    });
    if (!userId) {
      return match;
    }
    return `${String(prefix ?? "")}${formatMention({ userId })}`;
  });
}

export function rewriteDiscordKnownMentions(
  text: string,
  params: { accountId?: string | null },
): string {
  if (!text.includes("@")) {
    return text;
  }
  let rewritten = "";
  let offset = 0;
  MARKDOWN_CODE_SEGMENT_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MARKDOWN_CODE_SEGMENT_PATTERN)) {
    const matchIndex = match.index ?? 0;
    rewritten += rewritePlainTextMentions(text.slice(offset, matchIndex), params.accountId);
    rewritten += match[0];
    offset = matchIndex + match[0].length;
  }
  rewritten += rewritePlainTextMentions(text.slice(offset), params.accountId);
  return rewritten;
}

function collectUniqueIds(text: string, pattern: RegExp): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function extractDiscordMentionTargets(content: string): {
  users: string[];
  roles: string[];
} {
  if (!content.includes("<@")) {
    return { users: [], roles: [] };
  }
  return {
    users: collectUniqueIds(content, USER_MENTION_TOKEN_PATTERN),
    roles: collectUniqueIds(content, ROLE_MENTION_TOKEN_PATTERN),
  };
}

/**
 * Build an explicit `allowed_mentions` whitelist for the user and role IDs that appear
 * in `<@id>` / `<@&id>` syntax in `content`. Returning a strict whitelist (parse: [])
 * ensures Discord pings the targeted users/roles without parsing other mentions.
 * Returns `undefined` when content has no mention tokens.
 */
export function buildAllowedMentionsForContent(content: string): APIAllowedMentions | undefined {
  const { users, roles } = extractDiscordMentionTargets(content);
  if (users.length === 0 && roles.length === 0) {
    return undefined;
  }
  return { parse: [], users, roles };
}

type ProtectedRange = [number, number];

function collectProtectedRanges(text: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  for (const pattern of [MARKDOWN_CODE_SEGMENT_PATTERN, DISCORD_EMOJI_LITERAL_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      ranges.push([start, start + match[0].length]);
    }
  }
  ranges.sort(([a], [b]) => a - b);
  return ranges;
}

function isWithinAnyRange(index: number, ranges: ProtectedRange[]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function rewriteShortcodesOutsideProtectedRanges(
  text: string,
  ranges: ProtectedRange[],
  accountId: string | null | undefined,
  guildId: string,
): string {
  SHORTCODE_EMOJI_TOKEN_PATTERN.lastIndex = 0;
  return text.replace(SHORTCODE_EMOJI_TOKEN_PATTERN, (match, name: string, offset: number) => {
    if (isWithinAnyRange(offset, ranges)) {
      return match;
    }
    const cached = lookupDiscordGuildEmoji({ accountId, guildId, name });
    if (!cached) {
      return match;
    }
    return cached.animated ? `<a:${name}:${cached.id}>` : `<:${name}:${cached.id}>`;
  });
}

function collectShortcodeNamesOutsideProtectedRanges(
  text: string,
  ranges: ProtectedRange[],
): Set<string> {
  const names = new Set<string>();
  SHORTCODE_EMOJI_TOKEN_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(SHORTCODE_EMOJI_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (isWithinAnyRange(index, ranges)) {
      continue;
    }
    names.add(match[1]);
  }
  return names;
}

/**
 * Resolve `:name:` shortcodes in `text` to Discord's `<:name:id>` (or `<a:name:id>`
 * for animated) using the per-(accountId, guildId) emoji cache. Lazily fetches the
 * guild's emoji list at most once per call when the cache is cold and the message
 * actually contains shortcode tokens. Misses stay as plaintext.
 *
 * Existing `<:name:id>` / `<a:name:id>` Discord tokens in `text` are preserved as-is.
 * If `fetchEmojis` throws, the cache is left cold so a later call can retry — empty
 * results from a successful fetch ARE cached so that a guild with no custom emojis
 * doesn't trigger a fetch on every send.
 */
export async function rewriteDiscordShortcodeEmojis(
  text: string,
  params: {
    accountId?: string | null;
    guildId: string | null | undefined;
    fetchEmojis: () => Promise<DiscordEmojiInput[]>;
  },
): Promise<string> {
  const guildId = normalizeOptionalString(params.guildId);
  if (!guildId || !text.includes(":")) {
    return text;
  }
  const protectedRanges = collectProtectedRanges(text);
  const candidates = collectShortcodeNamesOutsideProtectedRanges(text, protectedRanges);
  if (candidates.size === 0) {
    return text;
  }
  if (!hasDiscordGuildEmojiCache({ accountId: params.accountId, guildId })) {
    let fetched: DiscordEmojiInput[] | undefined;
    try {
      fetched = await params.fetchEmojis();
    } catch {
      // Leave the cache cold so the next send can retry.
      return text;
    }
    rememberDiscordGuildEmojis({
      accountId: params.accountId,
      guildId,
      emojis: fetched ?? [],
    });
  }
  return rewriteShortcodesOutsideProtectedRanges(text, protectedRanges, params.accountId, guildId);
}

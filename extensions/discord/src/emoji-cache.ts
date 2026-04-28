import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";

export type DiscordCachedEmoji = {
  id: string;
  animated: boolean;
};

export type DiscordEmojiInput = {
  id: string | null | undefined;
  name: string | null | undefined;
  animated?: boolean | null;
};

const EMOJI_CACHE = new Map<string, Map<string, DiscordCachedEmoji>>();

function normalizeAccountCacheKey(accountId?: string | null): string {
  const normalized = normalizeAccountId(accountId ?? DEFAULT_ACCOUNT_ID);
  return normalized || DEFAULT_ACCOUNT_ID;
}

function buildBucketKey(accountId: string | null | undefined, guildId: string): string {
  return `${normalizeAccountCacheKey(accountId)}::${guildId}`;
}

export function rememberDiscordGuildEmojis(params: {
  accountId?: string | null;
  guildId: string;
  emojis: DiscordEmojiInput[];
}): void {
  const guildId = normalizeOptionalString(params.guildId);
  if (!guildId) {
    return;
  }
  const bucket = new Map<string, DiscordCachedEmoji>();
  for (const emoji of params.emojis) {
    const id = normalizeOptionalString(emoji.id ?? undefined);
    const name = normalizeOptionalString(emoji.name ?? undefined);
    if (!id || !name) {
      continue;
    }
    bucket.set(name, { id, animated: emoji.animated === true });
  }
  EMOJI_CACHE.set(buildBucketKey(params.accountId, guildId), bucket);
}

export function lookupDiscordGuildEmoji(params: {
  accountId?: string | null;
  guildId: string;
  name: string;
}): DiscordCachedEmoji | undefined {
  const guildId = normalizeOptionalString(params.guildId);
  const name = normalizeOptionalString(params.name);
  if (!guildId || !name) {
    return undefined;
  }
  return EMOJI_CACHE.get(buildBucketKey(params.accountId, guildId))?.get(name);
}

export function hasDiscordGuildEmojiCache(params: {
  accountId?: string | null;
  guildId: string;
}): boolean {
  const guildId = normalizeOptionalString(params.guildId);
  if (!guildId) {
    return false;
  }
  return EMOJI_CACHE.has(buildBucketKey(params.accountId, guildId));
}

export function forgetDiscordGuildEmojis(params: {
  accountId?: string | null;
  guildId: string;
}): void {
  const guildId = normalizeOptionalString(params.guildId);
  if (!guildId) {
    return;
  }
  EMOJI_CACHE.delete(buildBucketKey(params.accountId, guildId));
}

export function __resetDiscordEmojiCacheForTest(): void {
  EMOJI_CACHE.clear();
}

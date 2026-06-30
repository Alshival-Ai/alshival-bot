const alshivalPattern = /\balshival\b/i;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsAlshivalKeyword(text: string | undefined) {
  return alshivalPattern.test(text ?? "");
}

export function containsDiscordUserMention(text: string | undefined, userId: string | undefined) {
  if (!text || !userId) {
    return false;
  }

  return new RegExp(`<@!?${escapeRegExp(userId)}>`).test(text);
}

export function containsSlackUserMention(text: string | undefined, userId: string | undefined) {
  if (!text || !userId) {
    return false;
  }

  return new RegExp(`<@${escapeRegExp(userId)}(?:\\|[^>]+)?>`).test(text);
}

export function isSupportedSlackMessageSubtype(subtype: string | undefined) {
  return !subtype || subtype === "file_share";
}

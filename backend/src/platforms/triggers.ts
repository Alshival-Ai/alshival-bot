const alshivalPattern = /alshival/gi;
const whitespacePattern = /\s/;
const wordCharacterPattern = /[a-z0-9_]/i;
const referenceConnectorPattern = /[\/-]/;

function isWhitespace(value: string | undefined) {
  return value !== undefined && whitespacePattern.test(value);
}

function isWordCharacter(value: string | undefined) {
  return value !== undefined && wordCharacterPattern.test(value);
}

function isStandaloneAlshivalMatch(text: string, index: number) {
  const before = text[index - 1];
  const beforeBefore = text[index - 2];
  const afterIndex = index + "alshival".length;
  const after = text[afterIndex];
  const afterAfter = text[afterIndex + 1];

  // A spoken name has whitespace (or a message boundary) on at least one side.
  if (before !== undefined && after !== undefined && !isWhitespace(before) && !isWhitespace(after)) {
    return false;
  }

  if (isWordCharacter(before) || isWordCharacter(after)) {
    return false;
  }

  // Do not match path/repository names such as Alshival-Ai or docs/Alshival.
  if (referenceConnectorPattern.test(before ?? "") || referenceConnectorPattern.test(after ?? "")) {
    return false;
  }

  // A preceding dot or a dot followed by a word character denotes a hostname.
  // A trailing sentence period remains valid: "Thank you, Alshival."
  if (before === "." || (after === "." && isWordCharacter(afterAfter))) {
    return false;
  }

  // Keep @Alshival as a valid name, but exclude email-address fragments.
  if (after === "@" || (before === "@" && isWordCharacter(beforeBefore))) {
    return false;
  }

  return true;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsAlshivalKeyword(text: string | undefined) {
  if (!text) {
    return false;
  }

  for (const match of text.matchAll(alshivalPattern)) {
    if (isStandaloneAlshivalMatch(text, match.index)) {
      return true;
    }
  }

  return false;
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

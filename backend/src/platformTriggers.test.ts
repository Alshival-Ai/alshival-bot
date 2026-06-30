import assert from "node:assert/strict";
import test from "node:test";
import {
  containsAlshivalKeyword,
  containsDiscordUserMention,
  containsSlackUserMention,
  isSupportedSlackMessageSubtype,
} from "./platforms/triggers.js";

test("containsAlshivalKeyword matches the bot name case-insensitively", () => {
  assert.equal(containsAlshivalKeyword("Alshival can you help?"), true);
  assert.equal(containsAlshivalKeyword("alshival can you help?"), true);
  assert.equal(containsAlshivalKeyword("@Alshival can you help?"), true);
});

test("containsAlshivalKeyword requires the bot name as a keyword", () => {
  assert.equal(containsAlshivalKeyword("notalshival"), false);
  assert.equal(containsAlshivalKeyword("alshivalbot"), false);
  assert.equal(containsAlshivalKeyword(undefined), false);
});

test("containsDiscordUserMention matches Discord user mention formats", () => {
  assert.equal(containsDiscordUserMention("<@1234567890> ping", "1234567890"), true);
  assert.equal(containsDiscordUserMention("<@!1234567890> ping", "1234567890"), true);
  assert.equal(containsDiscordUserMention("<@12345678901> ping", "1234567890"), false);
});

test("containsSlackUserMention matches Slack user mention formats", () => {
  assert.equal(containsSlackUserMention("<@U12345> ping", "U12345"), true);
  assert.equal(containsSlackUserMention("<@U12345|Alshival> ping", "U12345"), true);
  assert.equal(containsSlackUserMention("<@U123456> ping", "U12345"), false);
});

test("isSupportedSlackMessageSubtype allows file shares", () => {
  assert.equal(isSupportedSlackMessageSubtype(undefined), true);
  assert.equal(isSupportedSlackMessageSubtype("file_share"), true);
  assert.equal(isSupportedSlackMessageSubtype("message_changed"), false);
});

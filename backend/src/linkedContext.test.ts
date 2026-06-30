import assert from "node:assert/strict";
import test from "node:test";
import { extractHttpUrls, extractLinkedContext } from "./linkedContext.js";

test("extractHttpUrls returns unique cleaned HTTP URLs", () => {
  assert.deepEqual(extractHttpUrls("See https://example.com/a, and https://example.com/a."), [
    "https://example.com/a",
  ]);
});

test("extractHttpUrls handles Slack-formatted links with labels", () => {
  assert.deepEqual(
    extractHttpUrls(
      "Notes: <https://notes.granola.ai/t/33596be0-ada6-47a3-bd74-c0f2b807bb02-009c2hma|GranolaSheila Demo>",
    ),
    ["https://notes.granola.ai/t/33596be0-ada6-47a3-bd74-c0f2b807bb02-009c2hma"],
  );
});

test("extractLinkedContext reads Granola-style embedded note HTML", async () => {
  globalThis.fetch = (async () =>
    new Response(
      String.raw`<!doctype html>
        <title>Meeting Notes</title>
        <meta property="og:description" content="Granola notes summary"/>
        <script>self.__next_f.push([1,"\u003ch3\u003eNext Steps\u003c/h3\u003e\n\u003cul\u003e\n\u003cli\u003eCreate Asana tasks for every owner\u003c/li\u003e\n\u003cli\u003eAssign Samuel the metrics follow-up\u003c/li\u003e\n\u003c/ul\u003e"])</script>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    )) as typeof fetch;

  const result = await extractLinkedContext("notes: https://notes.granola.ai/t/example");

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Meeting Notes");
  assert.match(result[0].text ?? "", /Granola notes summary/);
  assert.match(result[0].text ?? "", /Next Steps/);
  assert.match(result[0].text ?? "", /Create Asana tasks/);
});

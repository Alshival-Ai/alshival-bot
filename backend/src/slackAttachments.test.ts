import assert from "node:assert/strict";
import test from "node:test";
import * as xlsx from "xlsx";
import { extractSlackAttachments } from "./slackAttachments.js";

test("extractSlackAttachments reads plain text Slack files", async () => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as { Authorization?: string }).Authorization, "Bearer bot-token");

    return new Response("hello from slack", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }) as typeof fetch;

  const result = await extractSlackAttachments({
    botToken: "bot-token",
    files: [
      {
        id: "F1",
        name: "note.txt",
        mimetype: "text/plain",
        url_private_download: "https://files.slack.test/note.txt",
        size: 16,
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "note.txt");
  assert.equal(result[0].text, "hello from slack");
});

test("extractSlackAttachments includes supported images as data URLs", async () => {
  globalThis.fetch = (async () =>
    new Response(Buffer.from("fake-image"), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })) as typeof fetch;

  const result = await extractSlackAttachments({
    botToken: "bot-token",
    files: [
      {
        id: "F2",
        name: "screenshot.png",
        mimetype: "image/png",
        url_private_download: "https://files.slack.test/screenshot.png",
        size: 10,
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "screenshot.png");
  assert.match(result[0].text ?? "", /Image attachment included/);
  assert.equal(result[0].imageDataUrl, "data:image/png;base64,ZmFrZS1pbWFnZQ==");
});

test("extractSlackAttachments reads Excel workbooks", async () => {
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet([
    ["Task", "Owner"],
    ["Review workbook", "Samuel"],
  ]);
  xlsx.utils.book_append_sheet(workbook, sheet, "Actions");
  const buffer = xlsx.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;

  globalThis.fetch = (async () =>
    new Response(new Uint8Array(buffer), {
      status: 200,
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    })) as typeof fetch;

  const result = await extractSlackAttachments({
    botToken: "bot-token",
    files: [
      {
        id: "F3",
        name: "actions.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filetype: "xlsx",
        url_private_download: "https://files.slack.test/actions.xlsx",
        size: buffer.byteLength,
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "actions.xlsx");
  assert.match(result[0].text ?? "", /Sheet: Actions/);
  assert.match(result[0].text ?? "", /Review workbook,Samuel/);
});

test("extractSlackAttachments explains missing Slack file scope", async () => {
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;

    if (calls === 1) {
      return new Response("<!doctype html><html><body>Slack login</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: "missing_scope",
        needed: "files:read",
        provided: "chat:write,channels:history",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  const result = await extractSlackAttachments({
    botToken: "bot-token",
    files: [
      {
        id: "F4",
        name: "actions.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filetype: "xlsx",
        url_private_download: "https://files.slack.test/actions.xlsx",
        size: 10,
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.match(result[0].error ?? "", /missing the files:read scope/);
  assert.match(result[0].error ?? "", /reinstall the Slack app/);
});

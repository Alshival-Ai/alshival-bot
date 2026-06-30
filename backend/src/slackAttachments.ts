import * as mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as xlsx from "xlsx";

export type SlackFileAttachment = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  url_private?: string;
  url_private_download?: string;
  size?: number;
};

export type ExtractedSlackAttachment = {
  name: string;
  mimeType: string;
  size: number;
  text?: string;
  imageDataUrl?: string;
  error?: string;
};

const maxFiles = Number(process.env.SLACK_ATTACHMENT_MAX_FILES ?? 5);
const maxDownloadBytes = Number(process.env.SLACK_ATTACHMENT_MAX_DOWNLOAD_BYTES ?? 20 * 1024 * 1024);
const maxImageBytes = Number(process.env.SLACK_ATTACHMENT_MAX_IMAGE_BYTES ?? 8 * 1024 * 1024);
const maxTextCharsPerFile = Number(process.env.SLACK_ATTACHMENT_MAX_TEXT_CHARS_PER_FILE ?? 12_000);
const maxTextCharsTotal = Number(process.env.SLACK_ATTACHMENT_MAX_TEXT_CHARS_TOTAL ?? 30_000);

function getFileName(file: SlackFileAttachment) {
  return file.name?.trim() || file.title?.trim() || file.id?.trim() || "Slack attachment";
}

function getMimeType(file: SlackFileAttachment) {
  return file.mimetype?.trim().toLowerCase() || "";
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n\n[Truncated ${value.length - maxChars} characters.]`;
}

async function downloadSlackFile(file: SlackFileAttachment, botToken: string) {
  const url = file.url_private_download || file.url_private;

  if (!url) {
    throw new Error("Slack file did not include a private download URL.");
  }

  if (typeof file.size === "number" && file.size > maxDownloadBytes) {
    throw new Error(`Slack file exceeds download limit of ${maxDownloadBytes} bytes.`);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  if (!response.ok) {
    throw new Error(`Slack file download failed with status ${response.status}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (arrayBuffer.byteLength > maxDownloadBytes) {
    throw new Error(`Slack file exceeds download limit of ${maxDownloadBytes} bytes.`);
  }

  if (isSlackHtmlFileResponse(response, buffer)) {
    throw new Error(await getSlackFileAccessError(file, botToken));
  }

  return buffer;
}

function isSlackHtmlFileResponse(response: Response, buffer: Buffer) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const prefix = buffer.subarray(0, 200).toString("utf8").trimStart().toLowerCase();

  return (
    contentType.startsWith("text/html") &&
    (response.url.includes(".slack.com/?redir=") ||
      prefix.startsWith("<!doctype html") ||
      prefix.startsWith("<html"))
  );
}

async function getSlackFileAccessError(file: SlackFileAttachment, botToken: string) {
  if (!file.id) {
    return "Slack returned an HTML page instead of the file. Confirm the Slack app has files:read and was reinstalled after the scope was added.";
  }

  try {
    const response = await fetch(`https://slack.com/api/files.info?file=${encodeURIComponent(file.id)}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = (await response.json()) as {
      ok?: boolean;
      error?: string;
      needed?: string;
      provided?: string;
    };

    if (!data.ok && data.error === "missing_scope") {
      return `Slack app is missing the ${data.needed ?? "files:read"} scope required to read uploaded files. Add files:read to Bot Token Scopes, reinstall the Slack app to the workspace, and update the stored bot token if Slack rotates it. Current token scopes: ${data.provided ?? "unknown"}.`;
    }

    if (!data.ok) {
      return `Slack returned an HTML page instead of the file, and files.info failed with ${data.error ?? "unknown_error"}.`;
    }
  } catch {
    // Fall through to the generic remediation.
  }

  return "Slack returned an HTML page instead of the file. Confirm the Slack app has files:read and was reinstalled after the scope was added.";
}

async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractSpreadsheetText(buffer: Buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames.slice(0, 10)) {
    const sheet = workbook.Sheets[sheetName];
    const csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false }).trim();

    if (csv) {
      sections.push(`Sheet: ${sheetName}\n${csv}`);
    }
  }

  return sections.join("\n\n");
}

function isPlainTextMime(mimeType: string) {
  return (
    mimeType.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-ndjson",
      "application/x-yaml",
      "application/yaml",
    ].includes(mimeType)
  );
}

async function extractAttachment(file: SlackFileAttachment, botToken: string): Promise<ExtractedSlackAttachment> {
  const name = getFileName(file);
  const mimeType = getMimeType(file);
  const size = typeof file.size === "number" ? file.size : 0;

  try {
    const buffer = await downloadSlackFile(file, botToken);

    if (mimeType.startsWith("image/")) {
      if (buffer.byteLength > maxImageBytes) {
        throw new Error(`Image exceeds model input limit of ${maxImageBytes} bytes.`);
      }

      return {
        name,
        mimeType,
        size: buffer.byteLength,
        text: `[Image attachment included for visual analysis: ${name}]`,
        imageDataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
      };
    }

    if (mimeType === "application/pdf" || file.filetype === "pdf") {
      return { name, mimeType, size: buffer.byteLength, text: await extractPdfText(buffer) };
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.filetype === "docx"
    ) {
      return { name, mimeType, size: buffer.byteLength, text: await extractDocxText(buffer) };
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel" ||
      file.filetype === "xlsx" ||
      file.filetype === "xls"
    ) {
      return { name, mimeType, size: buffer.byteLength, text: extractSpreadsheetText(buffer) };
    }

    if (isPlainTextMime(mimeType) || ["text", "csv", "json", "markdown"].includes(file.filetype ?? "")) {
      return { name, mimeType, size: buffer.byteLength, text: buffer.toString("utf8") };
    }

    return {
      name,
      mimeType,
      size: buffer.byteLength,
      error: `Unsupported Slack attachment type: ${mimeType || file.filetype || "unknown"}.`,
    };
  } catch (error) {
    return {
      name,
      mimeType,
      size,
      error: error instanceof Error ? error.message : "Could not extract Slack attachment.",
    };
  }
}

export async function extractSlackAttachments(input: {
  files?: SlackFileAttachment[];
  botToken: string;
}) {
  const files = (input.files ?? []).slice(0, maxFiles);
  const extracted: ExtractedSlackAttachment[] = [];
  let remainingTextChars = maxTextCharsTotal;

  for (const file of files) {
    const result = await extractAttachment(file, input.botToken);

    if (result.text) {
      result.text = truncateText(result.text, Math.min(maxTextCharsPerFile, remainingTextChars));
      remainingTextChars = Math.max(0, remainingTextChars - result.text.length);
    }

    extracted.push(result);

    if (remainingTextChars <= 0) {
      break;
    }
  }

  if ((input.files ?? []).length > files.length) {
    extracted.push({
      name: "Additional Slack attachments",
      mimeType: "",
      size: 0,
      error: `${(input.files ?? []).length - files.length} attachment(s) skipped due to the ${maxFiles} file limit.`,
    });
  }

  return extracted;
}

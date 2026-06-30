import type { AgentAttachment } from "./agent.js";

const maxUrls = Number(process.env.LINK_CONTEXT_MAX_URLS ?? 5);
const maxDownloadBytes = Number(process.env.LINK_CONTEXT_MAX_DOWNLOAD_BYTES ?? 2 * 1024 * 1024);
const maxTextCharsPerUrl = Number(process.env.LINK_CONTEXT_MAX_TEXT_CHARS_PER_URL ?? 20_000);

const urlPattern = /\bhttps?:\/\/[^\s<>"'`|]+/gi;

function cleanUrl(raw: string) {
  return raw.split("|", 1)[0].replace(/[),.;!?]+$/g, "");
}

export function extractHttpUrls(text: string) {
  const urls = new Set<string>();

  for (const match of text.matchAll(urlPattern)) {
    try {
      const url = new URL(cleanUrl(match[0]));

      if (url.protocol === "http:" || url.protocol === "https:") {
        urls.add(url.toString());
      }
    } catch {
      // Ignore malformed URL-like text.
    }
  }

  return [...urls].slice(0, maxUrls);
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function decodeJavaScriptEscapes(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
}

function stripTags(value: string) {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function extractMetaContent(html: string, property: string) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  return decodeEntities(pattern.exec(html)?.[1] ?? "").trim();
}

function extractTitle(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  return stripTags(title);
}

function isNoisyHtmlChunk(text: string) {
  return (
    text.length > 1500 ||
    /(self\.__next|Promise\.withResolvers|requestAnimationFrame|static\/chunks|\$Sreact|Symbol\.for|function\(|webpack|\["\$)/i.test(
      text,
    )
  );
}

function extractStructuredHtmlText(html: string) {
  const decoded = decodeEntities(decodeJavaScriptEscapes(html));
  const chunks: string[] = [];
  const seen = new Set<string>();
  const title = extractTitle(decoded) || extractMetaContent(decoded, "og:title");
  const description = extractMetaContent(decoded, "og:description") || extractMetaContent(decoded, "description");

  if (title) {
    chunks.push(`# ${title}`);
    seen.add(title);
  }

  if (description && !seen.has(description)) {
    chunks.push(description);
    seen.add(description);
  }

  for (const match of decoded.matchAll(/<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(match[2]);

    if (text && text.length > 1 && !isNoisyHtmlChunk(text) && !seen.has(text)) {
      chunks.push(text);
      seen.add(text);
    }
  }

  if (chunks.length > 0) {
    return chunks.join("\n");
  }

  return stripTags(
    decoded
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " "),
  );
}

function truncateText(value: string) {
  if (value.length <= maxTextCharsPerUrl) {
    return value;
  }

  return `${value.slice(0, maxTextCharsPerUrl)}\n\n[Truncated ${value.length - maxTextCharsPerUrl} characters.]`;
}

async function fetchUrlContext(url: string): Promise<AgentAttachment> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1",
        "User-Agent": "AlshivalBot/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Link fetch failed with status ${response.status}.`);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > maxDownloadBytes) {
      throw new Error(`Link content exceeds download limit of ${maxDownloadBytes} bytes.`);
    }

    const raw = Buffer.from(arrayBuffer).toString("utf8");
    const text =
      contentType === "application/json"
        ? JSON.stringify(JSON.parse(raw), null, 2)
        : contentType === "text/plain"
          ? raw
          : extractStructuredHtmlText(raw);
    const title = contentType === "text/html" ? extractTitle(raw) || new URL(response.url).hostname : new URL(response.url).hostname;

    return {
      name: title,
      mimeType: contentType || "application/octet-stream",
      size: arrayBuffer.byteLength,
      text: `Source URL: ${response.url}\n\n${truncateText(text.trim())}`,
    };
  } catch (error) {
    return {
      name: url,
      mimeType: "",
      size: 0,
      error: error instanceof Error ? error.message : "Could not fetch link context.",
    };
  }
}

export async function extractLinkedContext(text: string) {
  const urls = extractHttpUrls(text).filter((url) => !/https:\/\/media\.tenor\.com\//i.test(url));
  const results: AgentAttachment[] = [];

  for (const url of urls) {
    results.push(await fetchUrlContext(url));
  }

  return results;
}

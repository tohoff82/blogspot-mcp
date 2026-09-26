import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

export type BodyDecodeResult =
  | { ok: true; canonicalBody: string }
  | { ok: false; detail: string };

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function encodeBody(value: string): string {
  return normalizeLineEndings(value)
    .split("\n\n")
    .map(paragraph => `<p>${paragraph.split("\n").map(escapeText).join("<br>")}</p>`)
    .join("\n");
}

function decodeParagraph(element: DefaultTreeAdapterTypes.Element): BodyDecodeResult {
  const parts: string[] = [];
  for (const child of element.childNodes) {
    if (child.nodeName === "#text") {
      parts.push((child as DefaultTreeAdapterTypes.TextNode).value);
      continue;
    }
    if (child.nodeName === "br") {
      parts.push("\n");
      continue;
    }
    return { ok: false, detail: `Unsupported element inside paragraph: ${child.nodeName}.` };
  }
  return { ok: true, canonicalBody: parts.join("") };
}

export function decodeBody(value: string): BodyDecodeResult {
  let fragment: DefaultTreeAdapterTypes.DocumentFragment;
  try {
    fragment = parseFragment(value);
  } catch {
    return { ok: false, detail: "Blogger content could not be parsed as an HTML fragment." };
  }

  const paragraphs: string[] = [];
  for (const node of fragment.childNodes) {
    if (node.nodeName === "#text") {
      const text = (node as DefaultTreeAdapterTypes.TextNode).value;
      if (text.trim().length === 0) continue;
      return { ok: false, detail: "Unexpected top-level text outside paragraph elements." };
    }
    if (node.nodeName !== "p") {
      return { ok: false, detail: `Unsupported top-level element: ${node.nodeName}.` };
    }
    const decoded = decodeParagraph(node as DefaultTreeAdapterTypes.Element);
    if (!decoded.ok) return decoded;
    paragraphs.push(decoded.canonicalBody);
  }

  if (paragraphs.length === 0) {
    return { ok: false, detail: "Blogger content did not contain any paragraph elements." };
  }
  return { ok: true, canonicalBody: paragraphs.join("\n\n") };
}

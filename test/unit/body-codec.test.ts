import { describe, expect, it } from "vitest";
import { decodeBody, encodeBody } from "../../src/domain/body-codec.js";

describe("body codec", () => {
  it("encodes the approved paragraph and escaping representation", () => {
    expect(encodeBody("First & second\r\ncontinued\r\n\r\nNext <paragraph> \"quoted\""))
      .toBe("<p>First &amp; second<br>continued</p>\n<p>Next &lt;paragraph&gt; &quot;quoted&quot;</p>");
  });

  it.each([
    ["<P>A&amp;B<BR/>next</P>\n<p>tail</p>", "A&B\nnext\n\ntail"],
    ["<p>first<br />second</p><p></p><p>fourth</p>", "first\nsecond\n\n\n\nfourth"],
    ["<p>&lt;safe&gt; &#39;text&#39;</p>", "<safe> 'text'"]
  ])("accepts narrow parser-level equivalents", (html, expected) => {
    expect(decodeBody(html)).toEqual({ ok: true, canonicalBody: expected });
  });

  it.each(["plain text", "<div>unexpected</div>", "<p>nested <strong>text</strong></p>"])(
    "rejects unsupported remote structure",
    html => expect(decodeBody(html).ok).toBe(false)
  );
});

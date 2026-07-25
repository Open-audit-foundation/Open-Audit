/**
 * Security Tests: XSS & Template Injection
 *
 * Acceptance criteria from issue:
 *  1. Test vectors passing aggressive script injections render as fully
 *     sanitized text literals in the dashboard output.
 *  2. Fuzzing scripts verify the backend core handles nested variable
 *     structures cleanly without breaking execution.
 */

import { describe, it, expect } from "vitest";
import {
  interpolateTemplate,
  sanitizeTemplateParam,
  sanitizeTextField,
  escapeHtml,
} from "../core";
import { translateEvent } from "../registry";
import { parseCustomAbi, customAbiToBlueprint } from "../custom-abi";
import type { RawEvent } from "../types";

// ── Helper ────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: "test-1",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    topics: ["0x74726e73"],
    data: "0x00",
    ledger: 1000,
    timestamp: 1700000000,
    txHash: "abc123",
    ...overrides,
  };
}

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes < > & \" '", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
    expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe(
      "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"
    );
    expect(escapeHtml("it's a trap & a <test>")).toBe(
      "it&#39;s a trap &amp; a &lt;test&gt;"
    );
  });

  it("leaves safe strings unchanged", () => {
    expect(escapeHtml("Transfer 100.00 XLM")).toBe("Transfer 100.00 XLM");
    expect(escapeHtml("GABC...1234")).toBe("GABC...1234");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

// ── sanitizeTemplateParam ─────────────────────────────────────────────────────

describe("sanitizeTemplateParam", () => {
  const XSS_VECTORS = [
    '<script>alert(1)</script>',
    '"><script>alert(document.cookie)</script>',
    "javascript:alert(1)",
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '{{7*7}}',           // template injection probe
    '${7*7}',            // JS template literal injection
    '\u003cscript\u003e', // unicode-escaped angle brackets
  ];

  for (const vector of XSS_VECTORS) {
    it(`neutralises: ${vector.slice(0, 40)}`, () => {
      const result = sanitizeTemplateParam(vector);
      expect(result).not.toContain("<script");
      expect(result).not.toContain("</script");
      expect(result).not.toContain("<img");
      expect(result).not.toContain("<svg");
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("onload");
      // Must not contain raw < or > that could break HTML context
      expect(result).not.toMatch(/<[a-zA-Z]/);
    });
  }

  it("caps length at 512 characters", () => {
    const long = "A".repeat(1000);
    expect(sanitizeTemplateParam(long).length).toBeLessThanOrEqual(512);
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeTemplateParam("  hello  ")).toBe("hello");
  });

  it("returns empty string for non-string input", () => {
    expect(sanitizeTemplateParam(undefined as any)).toBe("");
    expect(sanitizeTemplateParam(null as any)).toBe("");
    expect(sanitizeTemplateParam(42 as any)).toBe("");
  });
});

// ── sanitizeTextField ─────────────────────────────────────────────────────────

describe("sanitizeTextField", () => {
  it("escapes HTML in description text", () => {
    const result = sanitizeTextField('<b>bold</b> & "quoted"');
    expect(result).not.toContain("<b>");
    expect(result).toContain("&lt;b&gt;");
  });

  it("respects custom maxLength", () => {
    const result = sanitizeTextField("A".repeat(200), { maxLength: 50 });
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("defaults to 1024 character limit", () => {
    const result = sanitizeTextField("X".repeat(2000));
    expect(result.length).toBeLessThanOrEqual(1024);
  });

  it("allowHex skips escaping for pure hex strings", () => {
    const hex = "0xdeadbeefcafe1234";
    expect(sanitizeTextField(hex, { allowHex: true })).toBe(hex);
  });

  it("still escapes non-hex strings even with allowHex", () => {
    const mixed = "<script>0xdeadbeef";
    const result = sanitizeTextField(mixed, { allowHex: true });
    expect(result).not.toContain("<script>");
  });
});

// ── interpolateTemplate ───────────────────────────────────────────────────────

describe("interpolateTemplate", () => {
  it("replaces tokens with sanitized values", () => {
    const result = interpolateTemplate(
      "Transfer {amount} XLM from {from} to {to}",
      { amount: "100.00", from: "GABC...1234", to: "GDLZ...5678" }
    );
    expect(result).toBe("Transfer 100.00 XLM from GABC...1234 to GDLZ...5678");
  });

  it("neutralises XSS in param values", () => {
    const result = interpolateTemplate("Hello {name}", {
      name: '<script>alert(document.cookie)</script>',
    });
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("neutralises XSS in the template string itself", () => {
    const result = interpolateTemplate(
      '<img src=x onerror=alert(1)> {amount}',
      { amount: "100" }
    );
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
  });

  it("leaves unmatched tokens in place", () => {
    const result = interpolateTemplate("Hello {name}", {});
    expect(result).toBe("Hello {name}");
  });

  it("handles empty params object", () => {
    const result = interpolateTemplate("static text", {});
    expect(result).toBe("static text");
  });

  it("handles nested curly brace attempts without eval", () => {
    // Attempt to nest template tokens — should not recurse or eval
    const result = interpolateTemplate("{outer}", {
      outer: "{inner}",
      inner: "LEAKED",
    });
    // After one-pass replacement outer becomes "{inner}" (sanitized)
    // It must NOT be re-evaluated to "LEAKED"
    expect(result).not.toBe("LEAKED");
  });

  it("caps template length at 2048 characters", () => {
    const longTemplate = "{x}".repeat(1000);
    const result = interpolateTemplate(longTemplate, { x: "a" });
    // Template is capped before replacement so output is bounded
    expect(result.length).toBeLessThan(longTemplate.length);
  });

  it("handles non-string template gracefully", () => {
    expect(interpolateTemplate(undefined as any, {})).toBe("");
    expect(interpolateTemplate(null as any, {})).toBe("");
  });
});

// ── translateEvent XSS vectors ────────────────────────────────────────────────

describe("translateEvent — XSS in raw event data", () => {
  it("sanitizes XSS payload in event data field", () => {
    const event = makeEvent({
      data: '<script>alert(document.cookie)</script>',
    });
    const result = translateEvent(event);
    const desc = result.description ?? "";
    expect(desc).not.toContain("<script>");
    expect(desc).not.toContain("</script>");
  });

  it("sanitizes XSS payload in topics", () => {
    const event = makeEvent({
      topics: ['<img src=x onerror=alert(1)>', "0xcafe"],
    });
    const result = translateEvent(event);
    const desc = result.description ?? "";
    expect(desc).not.toContain("<img");
    expect(desc).not.toContain("onerror");
  });

  it("result is always a string or null — never executable code", () => {
    const event = makeEvent({ data: "javascript:alert(1)" });
    const result = translateEvent(event);
    if (result.description !== null) {
      expect(typeof result.description).toBe("string");
      expect(result.description).not.toContain("javascript:");
    }
  });
});

// ── Custom ABI sanitization ───────────────────────────────────────────────────

describe("customAbiToBlueprint — XSS in ABI-defined field names", () => {
  const maliciousAbi = parseCustomAbi({
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    contractName: '<script>alert("pwned")</script>',
    events: [
      {
        name: '<img src=x onerror=alert(1)>',
        fields: [
          { name: '<b>from</b>', type: 'address' },
          { name: 'amount', type: 'i128' },
        ],
      },
    ],
  });

  const blueprint = customAbiToBlueprint(maliciousAbi);
  const event = makeEvent({ topics: ["0x74726e73", "0xdeadbeef"], data: "0x000001" });
  const result = blueprint.translate(event, "en");

  it("sanitizes malicious event name in rendered output", () => {
    expect(result).not.toBeNull();
    const desc = result!.description;
    expect(desc).not.toContain("<img");
    expect(desc).not.toContain("onerror");
  });

  it("sanitizes malicious field name in rendered output", () => {
    const desc = result!.description ?? "";
    expect(desc).not.toContain("<b>");
    expect(desc).not.toContain("</b>");
  });
});

// ── Fuzzing: nested / deeply structured payloads ──────────────────────────────

describe("fuzzing — nested and edge-case inputs", () => {
  const FUZZ_VECTORS = [
    // Deeply nested braces — should not recurse
    "{{{{{xss}}}}}",
    // Null byte injection
    "hello\x00world",
    // Very long key name
    `{${"A".repeat(300)}}`,
    // Unicode homoglyphs for angle brackets
    "\u003cscript\u003e",
    // Template literal syntax
    "`${process.env}`",
    // Prototype pollution attempt
    "__proto__",
    // Zero-width characters
    "\u200B\u200C\u200D",
    // CRLF injection
    "line1\r\nX-Injected: true",
    // Null/undefined coercion
    String(null),
    String(undefined),
  ];

  for (const vector of FUZZ_VECTORS) {
    it(`sanitizeTemplateParam handles fuzz: ${JSON.stringify(vector).slice(0, 50)}`, () => {
      expect(() => sanitizeTemplateParam(vector)).not.toThrow();
      const result = sanitizeTemplateParam(vector);
      expect(typeof result).toBe("string");
      expect(result.length).toBeLessThanOrEqual(512);
      expect(result).not.toMatch(/<[a-zA-Z]/);
    });

    it(`interpolateTemplate handles fuzz in param: ${JSON.stringify(vector).slice(0, 50)}`, () => {
      expect(() =>
        interpolateTemplate("Value: {val}", { val: vector })
      ).not.toThrow();
    });

    it(`interpolateTemplate handles fuzz as template: ${JSON.stringify(vector).slice(0, 50)}`, () => {
      expect(() =>
        interpolateTemplate(vector, { x: "safe" })
      ).not.toThrow();
    });
  }
});

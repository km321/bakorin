/** @jsxImportSource react */
// SDK side of the json and richtext field types: form coercion and validation,
// table formatting, the server rendered form markup, and the RichText renderers.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { coerceValue, formatValue, inputValue, InvalidJson, validateField, type FieldSchema } from "@bakorin/sdk/headless";
import { renderField } from "@bakorin/sdk/astro-render";
import { Field, RichText } from "@bakorin/sdk/react";
import { sanitizeRichText as fromNext } from "@bakorin/sdk/next";
import { sanitizeRichText as fromAstro } from "@bakorin/sdk/astro";

const json: FieldSchema = { name: "settings", type: "json" };
const richtext: FieldSchema = { name: "body", type: "richtext" };

describe("json fields in SDK forms", () => {
  test("typed text is parsed, and text that does not parse is reported, not lost", () => {
    expect(coerceValue(json, '{ "a": [1, 2] }')).toEqual({ a: [1, 2] });
    expect(coerceValue(json, '"just a string"')).toBe("just a string");
    expect(coerceValue(json, "")).toBeNull();
    expect(coerceValue(json, { set: "in code" })).toEqual({ set: "in code" });
    const bad = coerceValue(json, "{ nope");
    expect(bad).toBeInstanceOf(InvalidJson);
    expect(validateField(json, bad)).toMatch(/^Settings must be valid JSON \(/);
    expect(inputValue(json, bad)).toBe("{ nope");
    expect(inputValue(json, { a: 1 })).toBe('{\n  "a": 1\n}');
    expect(validateField(json, { a: 1 })).toBeUndefined();
    expect(validateField({ ...json, required: true }, null)).toBe("Settings is required");
  });

  test("tables show compact JSON and the text of rich text", () => {
    expect(formatValue(json, { a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(formatValue(richtext, "<h2>Hello</h2><p>there <script>x()</script>friend</p>")).toBe("Hello there friend");
  });

  test("forms render a monospace textarea for json and a textarea for rich text", () => {
    const html = renderField(json, { idPrefix: "f", value: { a: 1 } });
    expect(html).toContain('class="bk-input bk-textarea bk-textarea--code"');
    expect(html).toContain('spellcheck="false"');
    expect(html).toContain("{\n  &quot;a&quot;: 1\n}");
    expect(renderField(richtext, { idPrefix: "f", value: "<p>x</p>" })).toContain("&lt;p&gt;x&lt;/p&gt;</textarea>");
    const react = renderToStaticMarkup(<Field field={json} value={[1]} onChange={() => {}} />);
    expect(react).toContain("bk-textarea--code");
  });
});

describe("RichText renderers", () => {
  test("React RichText cleans HTML again before it renders", () => {
    const html = renderToStaticMarkup(<RichText html={'<p>Hi<img src=x onerror="alert(1)"></p><script>alert(2)</script>'} className="post" as="article" />);
    expect(html).toBe('<article class="bk-richtext post"><p>Hi<img src="x" alt=""></p></article>');
    expect(renderToStaticMarkup(<RichText html={null} />)).toBe('<div class="bk-richtext"></div>');
  });

  test("Next and Astro helpers export the same sanitizer", () => {
    expect(fromNext('<a href="javascript:x()">a</a>')).toBe("<a>a</a>");
    expect(fromAstro('<a href="javascript:x()">a</a>')).toBe("<a>a</a>");
  });
});

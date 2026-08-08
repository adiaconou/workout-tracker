import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeCoachMarkdownLink,
  sanitizeCoachMarkdown,
} from "../src/client/coach/coach-markdown-policy";

test("allows absolute HTTP and HTTPS links from Coach markdown", () => {
  assert.equal(isSafeCoachMarkdownLink("https://example.com/training?q=upper#sets"), true);
  assert.equal(isSafeCoachMarkdownLink("http://localhost:8081/routines"), true);
  assert.equal(isSafeCoachMarkdownLink("  HTTPS://example.com/program  "), true);
});

test("rejects executable, local, relative, and malformed Coach markdown links", () => {
  assert.equal(isSafeCoachMarkdownLink("javascript:alert(1)"), false);
  assert.equal(isSafeCoachMarkdownLink("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeCoachMarkdownLink("file:///etc/passwd"), false);
  assert.equal(isSafeCoachMarkdownLink("mailto:coach@example.com"), false);
  assert.equal(isSafeCoachMarkdownLink("/routines"), false);
  assert.equal(isSafeCoachMarkdownLink("https://"), false);
  assert.equal(isSafeCoachMarkdownLink("https://example.com/unsafe\npath"), false);
});

test("neutralizes automatic images and unsafe Markdown destinations outside code", () => {
  const sanitized = sanitizeCoachMarkdown([
    "[Safe](https://example.com/guide)",
    "[Unsafe](javascript&#58;alert(1))",
    "[Relative](/routines)",
    "[Multiline destination](javascript:alert(1)",
    "  \"title\")",
    "[Multiline",
    "label](javascript:alert(1))",
    "![Tracker](https://tracker.example/pixel.gif)",
    "[Reference][unsafe]",
    "[unsafe]: data:text/html,unsafe",
    "<file:///tmp/secret>",
    "ftp://example.com/file",
    "coach@example.com",
    "",
    "```md",
    "![Code sample](https://example.com/image.png)",
    "```",
    "Inline `![also code](https://example.com/image.png)` sample.",
    "Inline `![multiline code]",
    "(https://example.com/image.png)` sample.",
    "",
    "> ```md",
    "> ![Quoted code](https://example.com/image.png)",
    "> ```",
  ].join("\n"));

  assert.match(sanitized, /\[Safe\]\(https:\/\/example\.com\/guide\)/u);
  assert.match(sanitized, /Image: \[Tracker\]\(https:\/\/tracker\.example\/pixel\.gif\)/u);
  assert.match(sanitized, /```md\n!\[Code sample\]/u);
  assert.match(sanitized, /`!\[also code\]/u);
  assert.match(sanitized, /`!\[multiline code\]\n\(https:\/\/example\.com\/image\.png\)`/u);
  assert.match(sanitized, /> ```md\n> !\[Quoted code\]/u);
  assert.match(sanitized, /\\\[Multiline destination/u);
  assert.match(sanitized, /\\\[Multiline\nlabel/u);
  assert.doesNotMatch(sanitized, /<file:\/\//iu);
  assert.match(sanitized, /ftp\\:\/\/example\.com/u);
  assert.match(sanitized, /coach\\@example\.com/u);
  assert.doesNotMatch(sanitized, /^!\[Tracker\]/mu);
});

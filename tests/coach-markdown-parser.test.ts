import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeCoachMarkdown } from "../src/features/coach/coach-markdown-policy";
// The exact renderer version ships this parser source; importing it directly
// makes this test an intentional upgrade canary for its web/WASM semantics.
import * as parserModule from "../node_modules/react-native-enriched-markdown/src/web/parseMarkdown";

type ParseMarkdown = (
    markdown: string,
    flags: { latexMath: boolean },
  ) => Promise<MarkdownNode>;

const runtimeParserModule = parserModule as unknown as {
  default?: { parseMarkdown: ParseMarkdown };
  parseMarkdown?: ParseMarkdown;
};
const parseMarkdown = runtimeParserModule.parseMarkdown
  ?? runtimeParserModule.default?.parseMarkdown;

if (!parseMarkdown) throw new Error("Markdown parser is unavailable");

type MarkdownNode = {
  type: string;
  content?: string;
  attributes?: Record<string, string>;
  children?: MarkdownNode[];
};

function flatten(node: MarkdownNode): MarkdownNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)];
}

test("parses the Markdown structures used in Coach replies", async () => {
  const ast = await parseMarkdown(sanitizeCoachMarkdown([
    "# Training plan",
    "",
    "Use **controlled reps** with *steady tempo*, `RPE 8`, and ~~junk volume~~.",
    "",
    "- Warm up",
    "- Add weight",
    "",
    "1. Squat",
    "2. Row",
    "",
    "- [x] Log the workout",
    "",
    "> Rest for two minutes.",
    "",
    "[Exercise guide](https://example.com/guide)",
    "",
    "| Exercise | Sets |",
    "| --- | ---: |",
    "| Squat | 3 |",
    "",
    "```text",
    "3 sets x 8 reps",
    "```",
  ].join("\n")), { latexMath: false });

  const nodes = flatten(ast);
  const types = new Set(nodes.map((node) => node.type));

  for (const expected of [
    "Heading",
    "Strong",
    "Emphasis",
    "Strikethrough",
    "Code",
    "UnorderedList",
    "OrderedList",
    "ListItem",
    "Blockquote",
    "Link",
    "CodeBlock",
    "Table",
    "TableHead",
    "TableBody",
    "TableHeaderCell",
    "TableCell",
  ]) {
    assert.equal(types.has(expected), true, `expected ${expected} in parsed Markdown`);
  }

  const link = nodes.find((node) => node.type === "Link");
  assert.equal(link?.attributes?.url, "https://example.com/guide");

  const task = nodes.find((node) => node.type === "ListItem" && node.attributes?.isTask === "true");
  assert.equal(task?.attributes?.taskChecked, "true");
});

test("keeps raw HTML inert instead of producing executable nodes", async () => {
  const ast = await parseMarkdown("<script>alert('unsafe')</script>", { latexMath: false });
  const nodes = flatten(ast);

  assert.equal(nodes.some((node) => /html|script/iu.test(node.type)), false);
  assert.equal(nodes.some((node) => node.type === "Text" && node.content?.includes("<script>")), true);
});

test("removes unsafe hrefs and remote image nodes before rendering", async () => {
  const markdown = sanitizeCoachMarkdown([
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
    "[Multiline reference][unsafe-multiline]",
    "",
    "[unsafe-multiline]:",
    "  javascript:alert(1)",
    "",
    "```md",
    "![Code sample](https://example.com/image.png)",
    "```",
    "",
    "> ```md",
    "> ![Quoted code](https://example.com/image.png)",
    "> ```",
    "",
    "Inline `![multiline code]",
    "(https://example.com/image.png)` sample.",
  ].join("\n"));
  const ast = await parseMarkdown(markdown, { latexMath: false });
  const nodes = flatten(ast);
  const links = nodes
    .filter((node) => node.type === "Link")
    .map((node) => node.attributes?.url);

  assert.deepEqual(links, [
    "https://example.com/guide",
    "https://tracker.example/pixel.gif",
  ]);
  assert.equal(nodes.some((node) => node.type === "Image"), false);
  assert.equal(nodes.some((node) => node.type === "Link" && !node.attributes?.url?.startsWith("https://")), false);
  assert.equal(
    nodes.some((node) => node.type === "CodeBlock" && JSON.stringify(node).includes("![Code sample]")),
    true,
  );
  assert.equal(
    nodes.filter((node) => node.type === "CodeBlock").some((node) => JSON.stringify(node).includes("![Quoted code]")),
    true,
  );
  assert.equal(
    nodes.some((node) => node.type === "Code" && JSON.stringify(node).includes("![multiline code]")),
    true,
    JSON.stringify(nodes.filter((node) => node.type === "Code")),
  );
});

test("fails closed when nested link labels reach the sanitizer depth limit", async () => {
  let markdown = "[Unsafe](javascript:alert(1)) ftp://example.com coach@example.com";
  for (let depth = 0; depth < 13; depth += 1) {
    markdown = `[${markdown}](https://example.com/${depth})`;
  }

  const ast = await parseMarkdown(sanitizeCoachMarkdown(markdown), { latexMath: false });
  const nodes = flatten(ast);
  const links = nodes.filter((node) => node.type === "Link");

  assert.equal(
    links.every((node) => /^https:\/\//u.test(node.attributes?.url ?? "")),
    true,
    JSON.stringify(links),
  );
});

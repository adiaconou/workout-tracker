const absoluteHttpUrl = /^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/iu;
const autoLinkScheme = /^[a-z][a-z\d+.-]{1,31}:/iu;
const autoLinkEmail = /^[^<>\s@]+@[^<>\s@]+$/u;
const markdownPunctuation = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");

export function isSafeCoachMarkdownLink(url: string): boolean {
  return absoluteHttpUrl.test(url.trim());
}

function decodeMarkdownDestination(destination: string): string {
  return destination
    .replace(/\\(.)/gu, (match, character: string) => (
      markdownPunctuation.has(character) ? character : match
    ))
    .replace(/&#(?:x([\da-f]+)|(\d+));/giu, (match, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      return String.fromCodePoint(codePoint);
    })
    .replace(/&colon;/gu, ":")
    .replace(/&Tab;/gu, "\t")
    .replace(/&NewLine;/gu, "\n");
}

function extractDestination(markdown: string): string | null {
  const value = markdown.trimStart();
  if (!value) return null;

  if (value.startsWith("<")) {
    const end = value.indexOf(">");
    return end > 0 ? decodeMarkdownDestination(value.slice(1, end)) : null;
  }

  let end = 0;
  let escaped = false;
  let nestedParentheses = 0;
  for (; end < value.length; end += 1) {
    const character = value[end];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (/\s/u.test(character)) break;
    if (character === "(") nestedParentheses += 1;
    if (character === ")") nestedParentheses -= 1;
  }

  return decodeMarkdownDestination(value.slice(0, end));
}

function isEscaped(markdown: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function countRun(markdown: string, index: number, character: string): number {
  let length = 0;
  while (markdown[index + length] === character) length += 1;
  return length;
}

function findClosingBackticks(markdown: string, start: number, length: number): number {
  const paragraphEnd = markdown.indexOf("\n\n", start);
  const limit = paragraphEnd === -1 ? markdown.length : paragraphEnd;
  let cursor = start;

  while (cursor < limit) {
    const next = markdown.indexOf("`", cursor);
    if (next === -1 || next >= limit) return -1;
    const runLength = countRun(markdown, next, "`");
    if (runLength === length) return next;
    cursor = next + runLength;
  }

  return -1;
}

function findClosingBracket(markdown: string, start: number): number {
  let depth = 1;
  for (let cursor = start; cursor < markdown.length && markdown[cursor] !== "\n"; cursor += 1) {
    if (isEscaped(markdown, cursor)) continue;
    if (markdown[cursor] === "[") depth += 1;
    if (markdown[cursor] === "]") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function findClosingParenthesis(markdown: string, start: number): number {
  let depth = 1;
  for (let cursor = start; cursor < markdown.length && markdown[cursor] !== "\n"; cursor += 1) {
    if (isEscaped(markdown, cursor)) continue;
    if (markdown[cursor] === "(") depth += 1;
    if (markdown[cursor] === ")") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

type Fence = { character: "`" | "~"; length: number; quoteDepth: number };

function blockquoteDepth(line: string): number {
  const prefix = /^(?: {0,3}>[ \t]?)+/u.exec(line)?.[0] ?? "";
  return [...prefix].filter((character) => character === ">").length;
}

function fenceOnLine(line: string): {
  character: "`" | "~";
  length: number;
  quoteDepth: number;
  rest: string;
} | null {
  const match = /^((?: {0,3}>[ \t]?)* {0,3})(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match) return null;
  const marker = match[2];
  return {
    character: marker[0] as "`" | "~",
    length: marker.length,
    quoteDepth: [...match[1]].filter((character) => character === ">").length,
    rest: match[3],
  };
}

function isTaskListMarker(markdown: string, index: number): boolean {
  const marker = markdown.slice(index, index + 3).toLowerCase();
  if (marker !== "[ ]" && marker !== "[x]") return false;
  if (markdown[index + 3] && !/\s/u.test(markdown[index + 3])) return false;
  const lineStart = markdown.lastIndexOf("\n", index - 1) + 1;
  return /^(?: {0,3})(?:[-+*]|\d+[.)])[ \t]+$/u.test(markdown.slice(lineStart, index));
}

function escapeMarkdownText(markdown: string): string {
  return [...markdown]
    .map((character) => (markdownPunctuation.has(character) ? `\\${character}` : character))
    .join("");
}

function sanitizeMarkdown(markdown: string, depth: number): string {
  if (depth > 12) return escapeMarkdownText(markdown);

  let result = "";
  let cursor = 0;
  let fence: Fence | null = null;

  while (cursor < markdown.length) {
    const atLineStart = cursor === 0 || markdown[cursor - 1] === "\n";
    if (atLineStart) {
      const newline = markdown.indexOf("\n", cursor);
      const lineEnd = newline === -1 ? markdown.length : newline;
      const line = markdown.slice(cursor, lineEnd);
      const lineFence = fenceOnLine(line);

      if (fence) {
        if (fence.quoteDepth > 0 && blockquoteDepth(line) < fence.quoteDepth) {
          fence = null;
        } else {
          if (
            lineFence
            && lineFence.character === fence.character
            && lineFence.length >= fence.length
            && lineFence.quoteDepth === fence.quoteDepth
            && lineFence.rest.trim().length === 0
          ) {
            fence = null;
          }
          result += markdown.slice(cursor, newline === -1 ? lineEnd : lineEnd + 1);
          cursor = newline === -1 ? lineEnd : lineEnd + 1;
          continue;
        }
      }

      if (
        lineFence
        && (lineFence.character === "~" || !lineFence.rest.includes("`"))
      ) {
        fence = {
          character: lineFence.character,
          length: lineFence.length,
          quoteDepth: lineFence.quoteDepth,
        };
        result += markdown.slice(cursor, newline === -1 ? lineEnd : lineEnd + 1);
        cursor = newline === -1 ? lineEnd : lineEnd + 1;
        continue;
      }

      const reference = /^( {0,3})\[([^\]\r\n]+)\]:[ \t]*(.*)$/u.exec(line);
      if (reference) {
        if (newline !== -1) result += "\n";
        cursor = newline === -1 ? lineEnd : lineEnd + 1;
        continue;
      }
    }

    const character = markdown[cursor];

    if (character === "`" && !isEscaped(markdown, cursor)) {
      const runLength = countRun(markdown, cursor, "`");
      const closing = findClosingBackticks(markdown, cursor + runLength, runLength);
      if (closing !== -1) {
        result += markdown.slice(cursor, closing + runLength);
        cursor = closing + runLength;
        continue;
      }
    }

    if (character === "!" && markdown[cursor + 1] === "[" && !isEscaped(markdown, cursor)) {
      result += "Image: ";
      cursor += 1;
      continue;
    }

    if (character === "[" && !isEscaped(markdown, cursor)) {
      const bracketEnd = findClosingBracket(markdown, cursor + 1);
      if (bracketEnd !== -1 && markdown[bracketEnd + 1] === "(") {
        const parenthesisEnd = findClosingParenthesis(markdown, bracketEnd + 2);
        if (parenthesisEnd !== -1) {
          const label = sanitizeMarkdown(markdown.slice(cursor + 1, bracketEnd), depth + 1);
          const linkSyntax = markdown.slice(bracketEnd + 1, parenthesisEnd + 1);
          const destination = extractDestination(markdown.slice(bracketEnd + 2, parenthesisEnd));

          if (destination && isSafeCoachMarkdownLink(destination)) {
            result += `[${label}]${linkSyntax}`;
          } else {
            result += label;
          }
          cursor = parenthesisEnd + 1;
          continue;
        }
      }

      if (!isTaskListMarker(markdown, cursor)) {
        result += "\\[";
        cursor += 1;
        continue;
      }
    }

    if (character === "<" && !isEscaped(markdown, cursor)) {
      const end = markdown.indexOf(">", cursor + 1);
      const newline = markdown.indexOf("\n", cursor + 1);
      if (end !== -1 && (newline === -1 || end < newline)) {
        const destination = decodeMarkdownDestination(markdown.slice(cursor + 1, end));
        if (
          (autoLinkScheme.test(destination) || autoLinkEmail.test(destination))
          && !isSafeCoachMarkdownLink(destination)
        ) {
          result += sanitizeMarkdown(destination, depth + 1);
          cursor = end + 1;
          continue;
        }
      }
    }

    if (!isEscaped(markdown, cursor)) {
      const previous = cursor > 0 ? markdown[cursor - 1] : "";
      if (!previous || !/[a-z\d+.-]/iu.test(previous)) {
        const scheme = /^([a-z][a-z\d+.-]{1,31}):/iu.exec(markdown.slice(cursor));
        if (scheme && !/^https?$/iu.test(scheme[1])) {
          result += `${scheme[1]}\\:`;
          cursor += scheme[0].length;
          continue;
        }
      }

      if (character === "@") {
        result += "\\@";
        cursor += 1;
        continue;
      }
    }

    result += character;
    cursor += 1;
  }

  return result;
}

export function sanitizeCoachMarkdown(markdown: string): string {
  return sanitizeMarkdown(markdown, 0);
}

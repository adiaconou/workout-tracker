import { Linking, Platform, StyleSheet } from "react-native";
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
} from "react-native-enriched-markdown";
import { colors, radii, spacing } from "../ui/tokens";
import {
  isSafeCoachMarkdownLink,
  sanitizeCoachMarkdown,
} from "./coach-markdown-policy";

const monospaceFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});

const markdownStyle: MarkdownStyle = {
  paragraph: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.md,
  },
  h1: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 31,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  h2: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 27,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  h3: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  h4: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  h5: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  h6: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  strong: { color: colors.text },
  em: { color: colors.text },
  link: { color: colors.accent, underline: true },
  code: {
    color: colors.accent,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    fontFamily: monospaceFont,
    fontSize: 13,
  },
  codeBlock: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: monospaceFont,
    fontSize: 13,
    lineHeight: 20,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  blockquote: {
    color: colors.textMuted,
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderWidth: 3,
    gapWidth: spacing.md,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.md,
  },
  list: {
    color: colors.text,
    bulletColor: colors.accent,
    markerColor: colors.accent,
    markerFontWeight: "700",
    markerMinWidth: 22,
    gapWidth: spacing.sm,
    marginLeft: spacing.md,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: spacing.md,
  },
  thematicBreak: {
    color: colors.borderStrong,
    height: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  table: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    headerBackgroundColor: colors.surfaceRaised,
    headerTextColor: colors.text,
    rowEvenBackgroundColor: colors.surface,
    rowOddBackgroundColor: colors.background,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radii.sm,
    cellPaddingHorizontal: spacing.sm,
    cellPaddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  taskList: {
    checkedColor: colors.accent,
    borderColor: colors.borderStrong,
    checkmarkColor: colors.background,
    checkedTextColor: colors.textMuted,
  },
};

type WebNavigationEvent = {
  target: {
    closest?: (selector: string) => {
      getAttribute?: (name: string) => string | null;
    } | null;
  } | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

function blockUnsafeWebNavigation(event: WebNavigationEvent) {
  const href = event.target?.closest?.("a")?.getAttribute?.("href");
  if (!href || isSafeCoachMarkdownLink(href)) return;
  event.preventDefault();
  event.stopPropagation();
}

const platformLinkGuards = Platform.OS === "web"
  ? {
      onClickCapture: blockUnsafeWebNavigation,
      onAuxClickCapture: blockUnsafeWebNavigation,
      onContextMenuCapture: blockUnsafeWebNavigation,
      onDragStartCapture: blockUnsafeWebNavigation,
    }
  : {
      enableLinkPreview: false,
      onLinkLongPress: () => undefined,
    };

export function CoachMarkdown({ content }: { content: string }) {
  const openLink = ({ url }: { url: string }) => {
    if (!isSafeCoachMarkdownLink(url)) return;
    void Linking.openURL(url.trim()).catch(() => undefined);
  };

  return (
    <EnrichedMarkdownText
      markdown={sanitizeCoachMarkdown(content)}
      flavor="github"
      md4cFlags={{ latexMath: false }}
      markdownStyle={markdownStyle}
      containerStyle={styles.container}
      selectable
      selectionColor={colors.borderStrong}
      onLinkPress={openLink}
      {...platformLinkGuards}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
});

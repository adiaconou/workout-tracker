import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, maxContentWidth, radii, spacing } from "../theme/tokens";

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: PropsWithChildren<{ scroll?: boolean; contentStyle?: ViewStyle }>) {
  const content = (
    <View style={[styles.content, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Eyebrow({ children }: PropsWithChildren) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Heading({
  children,
  size = "large",
}: PropsWithChildren<{ size?: "large" | "medium" | "small" }>) {
  return (
    <Text
      accessibilityRole="header"
      style={[
        styles.heading,
        size === "medium" && styles.headingMedium,
        size === "small" && styles.headingSmall,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  style,
}: PropsWithChildren<{ muted?: boolean; style?: ViewStyle | object }>) {
  return (
    <Text style={[styles.body, muted && styles.bodyMuted, style]}>{children}</Text>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[] }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  compact = false,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        compact && styles.buttonCompact,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.background : colors.text} />
      ) : (
        <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.accent}
        style={[styles.input, props.multiline && styles.inputMultiline, props.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function LoadingView({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

export function Message({
  children,
  tone = "error",
}: PropsWithChildren<{ tone?: "error" | "success" | "warning" }>) {
  return (
    <View style={[styles.message, styles[`message_${tone}`]]}>
      <Text style={[styles.messageText, styles[`messageText_${tone}`]]}>{children}</Text>
    </View>
  );
}

export function RowLink({
  children,
  onPress,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.rowLink, pressed && styles.rowPressed]}
    >
      {children}
      <Text style={styles.rowArrow}>→</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  content: {
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  heading: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "800",
    letterSpacing: -1.1,
  },
  headingMedium: { fontSize: 25, lineHeight: 30, letterSpacing: -0.6 },
  headingSmall: { fontSize: 18, lineHeight: 23, letterSpacing: -0.2 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  bodyMuted: { color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  button_primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  button_secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong },
  button_danger: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  button_ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  buttonCompact: { minHeight: 40, paddingVertical: spacing.sm },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.76 },
  buttonText: { fontSize: 15, fontWeight: "800" },
  buttonText_primary: { color: colors.background },
  buttonText_secondary: { color: colors.text },
  buttonText_danger: { color: colors.danger },
  buttonText_ghost: { color: colors.textMuted },
  field: { gap: 6 },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },
  fieldHint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  center: { flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingLabel: { color: colors.textMuted, fontSize: 14 },
  message: { borderRadius: radii.md, borderWidth: 1, padding: spacing.md },
  message_error: { backgroundColor: colors.dangerSurface, borderColor: colors.danger },
  message_success: { backgroundColor: colors.successSurface, borderColor: colors.success },
  message_warning: { backgroundColor: colors.warningSurface, borderColor: colors.warning },
  messageText: { fontSize: 13, lineHeight: 19 },
  messageText_error: { color: colors.danger },
  messageText_success: { color: colors.success },
  messageText_warning: { color: colors.warning },
  rowLink: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  rowArrow: { color: colors.textDim, fontSize: 18, marginLeft: "auto" },
});

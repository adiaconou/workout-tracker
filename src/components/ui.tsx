import { useId, useState, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
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
import { stepNumericText } from "./stepper-value";

type WebFieldAriaProps = {
  "aria-describedby"?: string;
  "aria-errormessage"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
};

type FieldProps = TextInputProps & WebFieldAriaProps & {
  label: string;
  hint?: string;
  error?: string;
};

export function Screen({
  children,
  scroll = true,
  safeTop = true,
  contentStyle,
}: PropsWithChildren<{ scroll?: boolean; safeTop?: boolean; contentStyle?: ViewStyle }>) {
  const content = (
    <View style={[styles.content, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView
      style={styles.safe}
      edges={safeTop ? ["top", "left", "right"] : ["left", "right"]}
    >
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
  level,
}: PropsWithChildren<{
  size?: "large" | "medium" | "small";
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}>) {
  const semanticLevel = level ?? (size === "large" ? 1 : size === "medium" ? 2 : 3);
  const webHeadingProps = Platform.OS === "web"
    ? { "aria-level": semanticLevel }
    : {};
  return (
    <Text
      accessibilityRole="header"
      role="heading"
      {...webHeadingProps}
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
  accessibilityLabel = title,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        compact && styles.buttonCompact,
        unavailable && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        focused && Platform.OS === "web" && styles.webFocusRing,
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
  error,
  ...props
}: FieldProps) {
  const id = useId();
  const labelId = `field-label-${id}`;
  const hintId = `field-hint-${id}`;
  const errorId = `field-error-${id}`;
  const [focused, setFocused] = useState(false);
  const webRelationshipProps = fieldWebRelationshipProps({
    hintId: hint ? hintId : null,
    errorId: error ? errorId : null,
    labelledBy:
      props["aria-labelledby"] ??
      idReferenceList(props.accessibilityLabelledBy) ??
      (props.accessibilityLabel ? null : labelId),
    callerDescribedBy: props["aria-describedby"],
    callerErrorMessage: props["aria-errormessage"],
    callerInvalid: props["aria-invalid"],
  });
  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        {...webRelationshipProps}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityLabelledBy={
          Platform.OS === "web"
            ? undefined
            : props.accessibilityLabelledBy ?? (props.accessibilityLabel ? undefined : labelId)
        }
        accessibilityHint={
          props.accessibilityHint ?? fieldAccessibilityHint(hint, error)
        }
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.accent}
        style={[
          styles.input,
          props.multiline && styles.inputMultiline,
          focused && styles.inputFocused,
          focused && Platform.OS === "web" && styles.webFocusRing,
          props.style,
        ]}
      />
      {hint ? <Text nativeID={hintId} style={styles.fieldHint}>{hint}</Text> : null}
      {error ? (
        <Text
          nativeID={errorId}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.fieldError}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function StepperField({
  label,
  hint,
  value,
  onChangeText,
  minimum = 0,
  step = 1,
  error,
  ...props
}: Omit<FieldProps, "onChangeText" | "value"> & {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChangeText: (value: string) => void;
  minimum?: number;
  step?: number;
}) {
  const numericValue = Number(value);
  const disabled = props.editable === false;
  const id = useId();
  const labelId = `stepper-label-${id}`;
  const hintId = `stepper-hint-${id}`;
  const errorId = `stepper-error-${id}`;
  const [focusedControl, setFocusedControl] = useState<"decrease" | "input" | "increase" | null>(null);
  const canDecrement =
    !disabled && Number.isFinite(numericValue) && numericValue > minimum;
  const webRelationshipProps = fieldWebRelationshipProps({
    hintId: hint ? hintId : null,
    errorId: error ? errorId : null,
    labelledBy:
      props["aria-labelledby"] ??
      idReferenceList(props.accessibilityLabelledBy) ??
      (props.accessibilityLabel ? null : labelId),
    callerDescribedBy: props["aria-describedby"],
    callerErrorMessage: props["aria-errormessage"],
    callerInvalid: props["aria-invalid"],
  });

  function changeBy(delta: number) {
    onChangeText(stepNumericText(value, delta, minimum));
  }

  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={styles.fieldLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label} by ${step}`}
          accessibilityState={{ disabled: !canDecrement }}
          disabled={!canDecrement}
          onBlur={() => setFocusedControl(null)}
          onFocus={() => setFocusedControl("decrease")}
          onPress={() => changeBy(-step)}
          style={({ pressed }) => [
            styles.stepperButton,
            !canDecrement && styles.stepperButtonDisabled,
            pressed && canDecrement && styles.stepperButtonPressed,
            focusedControl === "decrease" && Platform.OS === "web" && styles.webFocusRing,
          ]}
        >
          <Text style={styles.stepperButtonText}>−</Text>
        </Pressable>
        <TextInput
          {...props}
          {...webRelationshipProps}
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={props.accessibilityLabel ?? label}
          accessibilityLabelledBy={
            Platform.OS === "web"
              ? undefined
              : props.accessibilityLabelledBy ?? (props.accessibilityLabel ? undefined : labelId)
          }
          accessibilityHint={
            props.accessibilityHint ?? fieldAccessibilityHint(hint, error)
          }
          onBlur={(event) => {
            setFocusedControl(null);
            props.onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocusedControl("input");
            props.onFocus?.(event);
          }}
          placeholderTextColor={colors.textDim}
          selectionColor={colors.accent}
          style={[
            styles.input,
            styles.stepperInput,
            focusedControl === "input" && styles.inputFocused,
            focusedControl === "input" && Platform.OS === "web" && styles.webFocusRing,
            props.style,
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label} by ${step}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onBlur={() => setFocusedControl(null)}
          onFocus={() => setFocusedControl("increase")}
          onPress={() => changeBy(step)}
          style={({ pressed }) => [
            styles.stepperButton,
            disabled && styles.stepperButtonDisabled,
            pressed && !disabled && styles.stepperButtonPressed,
            focusedControl === "increase" && Platform.OS === "web" && styles.webFocusRing,
          ]}
        >
          <Text style={styles.stepperButtonText}>+</Text>
        </Pressable>
      </View>
      {hint ? <Text nativeID={hintId} style={styles.fieldHint}>{hint}</Text> : null}
      {error ? (
        <Text
          nativeID={errorId}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.fieldError}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function fieldAccessibilityHint(hint?: string, error?: string) {
  return [error ? `Error: ${error}` : null, hint]
    .filter((value): value is string => Boolean(value))
    .join(". ") || undefined;
}

function idReferenceList(value?: string | string[]) {
  return Array.isArray(value) ? value.join(" ") : value;
}

function mergeIdReferences(...values: Array<string | undefined>) {
  const references = new Set(
    values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []),
  );
  return references.size > 0 ? [...references].join(" ") : undefined;
}

function fieldWebRelationshipProps({
  hintId,
  errorId,
  labelledBy,
  callerDescribedBy,
  callerErrorMessage,
  callerInvalid,
}: {
  hintId: string | null;
  errorId: string | null;
  labelledBy: string | null;
  callerDescribedBy?: string;
  callerErrorMessage?: string;
  callerInvalid?: WebFieldAriaProps["aria-invalid"];
}) {
  if (Platform.OS !== "web") return {};
  const generatedDescribedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return {
    "aria-labelledby": labelledBy ?? undefined,
    "aria-describedby": mergeIdReferences(callerDescribedBy, generatedDescribedBy),
    "aria-errormessage": errorId ?? callerErrorMessage,
    "aria-invalid": errorId ? true : callerInvalid,
  };
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
    <View
      role={tone === "error" ? "alert" : "status"}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      style={[styles.message, styles[`message_${tone}`]]}
    >
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
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.rowLink,
        pressed && styles.rowPressed,
        focused && Platform.OS === "web" && styles.webFocusRing,
      ]}
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
  buttonCompact: { minHeight: 44, paddingVertical: spacing.sm },
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
  inputFocused: { borderColor: colors.accent },
  stepperRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  stepperInput: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  stepperButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  stepperButtonDisabled: { opacity: 0.35 },
  stepperButtonPressed: {
    backgroundColor: colors.accentDark,
    borderColor: colors.accent,
  },
  stepperButtonText: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "700",
  },
  fieldHint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  fieldError: { color: colors.danger, fontSize: 12, lineHeight: 17, fontWeight: "700" },
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
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: -2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});

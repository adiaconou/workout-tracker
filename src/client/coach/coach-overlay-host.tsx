import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "expo-router";
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing } from "../ui/tokens";
import { CoachScreen, type CoachScreenStatus } from "./coach-screen";

type OpenCoachOptions = {
  fullScreen?: boolean;
  starter?: string;
};

type CoachOverlayContextValue = {
  visible: boolean;
  expanded: boolean;
  status: CoachScreenStatus;
  hasUnread: boolean;
  openCoach: (options?: OpenCoachOptions) => void;
  closeCoach: () => void;
  setExpanded: (expanded: boolean) => void;
};

const CoachOverlayContext = createContext<CoachOverlayContextValue | null>(null);

export function CoachOverlayProvider({
  children,
  enabled,
  sessionKey,
}: PropsWithChildren<{ enabled: boolean; sessionKey?: string }>) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [starter, setStarter] = useState<string | undefined>();
  const [status, setStatus] = useState<CoachScreenStatus>("idle");
  const [hasUnread, setHasUnread] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const previousStatusRef = useRef<CoachScreenStatus>("idle");
  const previousSessionKeyRef = useRef(sessionKey);

  const closeCoach = useCallback(() => {
    Keyboard.dismiss();
    if (Platform.OS === "web" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setVisible(false);
  }, []);
  const openCoach = useCallback((options?: OpenCoachOptions) => {
    setMounted(true);
    setVisible(true);
    setExpanded(Boolean(options?.fullScreen));
    setHasUnread(false);
    if (options?.starter) setStarter(options.starter);
  }, []);

  useEffect(() => {
    const sessionChanged = previousSessionKeyRef.current !== sessionKey;
    previousSessionKeyRef.current = sessionKey;
    if (enabled && !sessionChanged) return;
    setVisible(false);
    setMounted(false);
    setExpanded(false);
    setStarter(undefined);
    setStatus("idle");
    setHasUnread(false);
    previousStatusRef.current = "idle";
  }, [enabled, sessionKey]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (!visible && previousStatus === "working" && status !== "working") {
      setHasUnread(true);
    }
  }, [status, visible]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === "web") {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") closeCoach();
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeCoach();
      return true;
    });
    return () => subscription.remove();
  }, [closeCoach, visible]);

  const value = useMemo<CoachOverlayContextValue>(() => ({
    visible,
    expanded,
    status,
    hasUnread,
    openCoach,
    closeCoach,
    setExpanded,
  }), [closeCoach, expanded, hasUnread, openCoach, status, visible]);

  const compact = width < 768;
  const showFloatingLauncher = enabled
    && !visible
    && !keyboardVisible
    && isCoachFloatingRoute(pathname);
  const statusCopy = coachStatusCopy(status);

  return (
    <CoachOverlayContext.Provider value={value}>
      <View style={styles.providerRoot}>
        <View
          accessibilityElementsHidden={visible}
          importantForAccessibility={visible ? "no-hide-descendants" : "auto"}
          style={styles.appContent}
        >
          {children}
        </View>

        {showFloatingLauncher ? (
          <View style={[
            styles.floatingLauncher,
            { right: spacing.lg + insets.right, bottom: spacing.lg + insets.bottom },
          ]}>
            <CoachLauncher variant="floating" />
          </View>
        ) : null}

        {mounted ? (
          <View
            accessibilityElementsHidden={!visible}
            importantForAccessibility={visible ? "yes" : "no-hide-descendants"}
            pointerEvents={visible ? "auto" : "none"}
            style={[styles.overlayRoot, !visible && styles.hidden]}
          >
            {!expanded ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Coach"
                onPress={closeCoach}
                style={styles.backdrop}
              />
            ) : null}
            <View
              accessibilityLabel="Coach chat"
              accessibilityViewIsModal
              onAccessibilityEscape={closeCoach}
              role="dialog"
              style={[
                styles.panel,
                expanded
                  ? styles.fullPanel
                  : compact
                  ? styles.sheetPanel
                  : [styles.drawerPanel, { width: Math.min(480, Math.max(420, width * 0.38)) }],
              ]}
            >
              <View style={[
                styles.overlayHeader,
                { paddingTop: expanded || !compact ? insets.top + spacing.sm : spacing.sm },
              ]}>
                <View style={styles.titleGroup}>
                  <View accessible={false} style={styles.coachMark}>
                    <Text style={styles.coachMarkText}>C</Text>
                  </View>
                  <View style={styles.titleCopy}>
                    <Text style={styles.title}>Coach</Text>
                    <Text accessibilityLiveRegion="polite" style={styles.statusText}>{statusCopy}</Text>
                  </View>
                </View>
                <View style={styles.overlayActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={expanded ? "Return Coach to popover" : "Open Coach full screen"}
                    onPress={() => setExpanded(!expanded)}
                    style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
                  >
                    <Text style={styles.textActionLabel}>{expanded ? "Pop over" : "Full screen"}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close Coach"
                    onPress={closeCoach}
                    style={({ pressed }) => [styles.closeAction, pressed && styles.pressed]}
                  >
                    <Text aria-hidden accessible={false} style={styles.closeActionLabel}>×</Text>
                  </Pressable>
                </View>
              </View>
              <View style={[styles.coachBody, { paddingBottom: insets.bottom }]}>
                <CoachScreen
                  embedded
                  visible={visible}
                  starter={starter}
                  onStarterConsumed={() => setStarter(undefined)}
                  onStatusChange={setStatus}
                />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </CoachOverlayContext.Provider>
  );
}

export function useCoachOverlay() {
  const value = useContext(CoachOverlayContext);
  if (!value) throw new Error("useCoachOverlay must be used inside CoachOverlayProvider.");
  return value;
}

export function CoachLauncher({ variant = "header" }: { variant?: "header" | "floating" }) {
  const { hasUnread, openCoach, status } = useCoachOverlay();
  const attention = hasUnread || status === "review" || status === "error";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={coachLauncherLabel(status, hasUnread)}
      accessibilityHint="Opens Coach without leaving this screen"
      onPress={() => openCoach()}
      style={({ pressed }) => [
        styles.launcher,
        variant === "floating" && styles.launcherFloating,
        pressed && styles.pressed,
      ]}
    >
      <CoachBubbleGlyph active={status === "working"} />
      {attention ? (
        <View accessible={false} style={styles.attentionBadge}>
          <Text style={styles.attentionBadgeText}>!</Text>
        </View>
      ) : status === "working" ? (
        <View accessible={false} style={styles.workingBadge} />
      ) : null}
    </Pressable>
  );
}

function CoachBubbleGlyph({ active }: { active: boolean }) {
  const tint = active ? colors.accent : colors.text;
  return (
    <View accessible={false} style={[styles.bubbleGlyph, { borderColor: tint }]}>
      <View style={[styles.bubbleDot, { backgroundColor: tint }]} />
      <View style={[styles.bubbleDot, { backgroundColor: tint }]} />
      <View style={[styles.bubbleTail, { borderTopColor: tint }]} />
    </View>
  );
}

function isCoachFloatingRoute(pathname: string) {
  return /^\/(?:routines\/(?:new|[^/]+)|exercises\/(?:new|[^/]+)|history\/[^/]+|profile)$/.test(pathname);
}

function coachStatusCopy(status: CoachScreenStatus) {
  if (status === "working") return "Working on your request";
  if (status === "review") return "A change is ready to review";
  if (status === "error") return "Needs your attention";
  return "Ready whenever you are";
}

function coachLauncherLabel(status: CoachScreenStatus, hasUnread: boolean) {
  if (hasUnread) return "Open Coach chat, new reply";
  if (status === "working") return "Open Coach chat, response in progress";
  if (status === "review") return "Open Coach chat, change ready to review";
  if (status === "error") return "Open Coach chat, needs attention";
  return "Open Coach chat";
}

const styles = StyleSheet.create({
  providerRoot: { flex: 1, backgroundColor: colors.background },
  appContent: { flex: 1 },
  overlayRoot: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 24,
  },
  hidden: { display: "none" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(3, 6, 11, 0.68)",
  },
  panel: {
    position: "absolute",
    overflow: "hidden",
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: -4, height: 0 },
  },
  sheetPanel: {
    left: 0,
    right: 0,
    bottom: 0,
    height: "86%",
    borderTopWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  drawerPanel: {
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: 1,
  },
  fullPanel: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  overlayHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  titleGroup: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  coachMark: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  coachMarkText: { color: colors.background, fontSize: 16, fontWeight: "900" },
  titleCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  statusText: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  overlayActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  textAction: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  textActionLabel: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  closeAction: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  closeActionLabel: { color: colors.textMuted, fontSize: 27, lineHeight: 30, fontWeight: "400" },
  coachBody: { flex: 1, minHeight: 0 },
  floatingLauncher: { position: "absolute", zIndex: 30, elevation: 12 },
  launcher: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
  },
  launcherFloating: {
    width: 54,
    height: 54,
    borderColor: colors.accent,
    shadowColor: "#000000",
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  bubbleGlyph: {
    width: 22,
    height: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 2,
    borderRadius: 7,
  },
  bubbleDot: { width: 3, height: 3, borderRadius: radii.pill },
  bubbleTail: {
    position: "absolute",
    right: 2,
    bottom: -5,
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderLeftColor: "transparent",
    borderTopWidth: 5,
    borderRightWidth: 0,
    borderRightColor: "transparent",
  },
  attentionBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.surfaceRaised,
    backgroundColor: colors.warning,
  },
  attentionBadgeText: { color: colors.background, fontSize: 9, lineHeight: 11, fontWeight: "900" },
  workingBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.surfaceRaised,
    backgroundColor: colors.accent,
  },
  pressed: { opacity: 0.68 },
});

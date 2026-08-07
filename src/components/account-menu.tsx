import { useEffect, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/auth-context";
import { colors, maxContentWidth, radii, spacing } from "../theme/tokens";
import {
  profileDisplayName,
  profileInitials,
  safeProfilePhotoUrl,
} from "./profile-display";

export function AccountHeader() {
  const { isLoading, signOut, user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [focusedControl, setFocusedControl] = useState<string | null>(null);

  useEffect(() => {
    if (!user) setOpen(false);
  }, [user]);

  if (!user) return null;

  const displayName = profileDisplayName(user.displayName, user.email);
  const horizontalInset = Math.max(
    spacing.lg,
    (width - maxContentWidth) / 2 + spacing.lg,
  );

  async function handleSignOut() {
    setOpen(false);
    await signOut();
  }

  return (
    <>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={[
          styles.headerInner,
          {
            paddingLeft: spacing.lg + insets.left,
            paddingRight: spacing.lg + insets.right,
          },
        ]}>
          <View accessible={false} style={styles.brand}>
            <View style={styles.brandMark} />
            <Text style={styles.brandText}>Workout Tracker</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Account menu for ${displayName}`}
            accessibilityState={{ expanded: open, disabled: isLoading }}
            disabled={isLoading}
            onBlur={() => setFocusedControl(null)}
            onFocus={() => setFocusedControl("account")}
            onPress={() => setOpen(true)}
            style={({ pressed }) => [
              styles.accountTrigger,
              pressed && styles.pressed,
              isLoading && styles.disabled,
              focusedControl === "account" && Platform.OS === "web" && styles.webFocusRing,
            ]}
          >
            <ProfileAvatar
              displayName={user.displayName}
              email={user.email}
              photoUrl={user.photoUrl}
              size={30}
            />
            <Text numberOfLines={1} style={styles.triggerName}>{displayName}</Text>
            <Text aria-hidden accessible={false} style={styles.chevron}>⌄</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close account menu"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.menu,
              {
                right: horizontalInset + insets.right,
                top: insets.top + 54,
              },
            ]}
          >
            <View style={styles.profile}>
              <ProfileAvatar
                displayName={user.displayName}
                email={user.email}
                photoUrl={user.photoUrl}
                size={44}
              />
              <View style={styles.profileCopy}>
                <Text numberOfLines={1} style={styles.profileName}>{displayName}</Text>
                <Text numberOfLines={1} style={styles.profileEmail}>{user.email}</Text>
              </View>
            </View>
            <View style={styles.menuDivider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              disabled={isLoading}
              onBlur={() => setFocusedControl(null)}
              onFocus={() => setFocusedControl("sign-out")}
              onPress={() => void handleSignOut()}
              style={({ pressed }) => [
                styles.signOutAction,
                pressed && styles.signOutPressed,
                isLoading && styles.disabled,
                focusedControl === "sign-out" && Platform.OS === "web" && styles.webFocusRing,
              ]}
            >
              <Text style={styles.signOutText}>{isLoading ? "Signing out…" : "Sign out"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ProfileAvatar({
  displayName,
  email,
  photoUrl,
  size,
}: {
  displayName: string;
  email: string;
  photoUrl?: string | null;
  size: number;
}) {
  const source = safeProfilePhotoUrl(photoUrl);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [source]);

  const avatarStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (source && !imageFailed) {
    return (
      <Image
        accessible={false}
        onError={() => setImageFailed(true)}
        source={{ uri: source }}
        style={[styles.avatar, avatarStyle]}
      />
    );
  }

  return (
    <View accessible={false} style={[styles.avatar, styles.avatarFallback, avatarStyle]}>
      <Text style={[styles.avatarInitials, { fontSize: Math.max(10, Math.round(size * 0.36)) }]}>
        {profileInitials(displayName, email)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerInner: {
    width: "100%",
    maxWidth: maxContentWidth,
    minHeight: 50,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  brandMark: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.accent },
  brandText: { color: colors.text, fontSize: 13, fontWeight: "900", letterSpacing: 0.15 },
  accountTrigger: {
    minHeight: 44,
    maxWidth: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  triggerName: { maxWidth: 132, color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  chevron: { color: colors.textDim, fontSize: 14, lineHeight: 18 },
  avatar: { flexShrink: 0, borderWidth: 1, borderColor: colors.borderStrong },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.accentDark },
  avatarInitials: { color: colors.accent, fontWeight: "900", letterSpacing: 0.4 },
  modalRoot: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(3, 6, 11, 0.42)" },
  menu: {
    position: "absolute",
    width: "88%",
    maxWidth: 320,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.md,
  },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  profileCopy: { flex: 1, minWidth: 0, gap: 2 },
  profileName: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  profileEmail: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  signOutAction: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.background,
  },
  signOutPressed: { backgroundColor: colors.dangerSurface },
  signOutText: { color: colors.danger, fontSize: 13, fontWeight: "800" },
  pressed: { backgroundColor: colors.surfaceRaised },
  disabled: { opacity: 0.48 },
  webFocusRing: {
    outlineColor: colors.accent,
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
});

import { Platform, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/auth/auth-context";
import {
  Body,
  Button,
  Card,
  Eyebrow,
  Heading,
  Message,
  Screen,
} from "../src/components/ui";
import { colors, spacing } from "../src/theme/tokens";

export default function SignInRoute() {
  const { error, isLoading, retry, signIn } = useAuth();
  const isWeb = Platform.OS === "web";
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.mark}>
        <Text style={styles.markText}>WT</Text>
      </View>
      <Eyebrow>Workout Tracker</Eyebrow>
      <Heading>One set at a time.</Heading>
      <Body muted>
        Run your rolling A–D program, keep every set durable, and choose today’s workout
        with recovery-aware guidance.
      </Body>
      <Card style={styles.authCard}>
        <Heading size="small">{isWeb ? "Sign in with ChatGPT" : "Sign in on Android"}</Heading>
        <Body muted>
          {isWeb
            ? "Use a ChatGPT account approved for this tracker. Routines, workouts, and coaching history stay separate for each account."
            : "Continue with your authorized Google account. Workout data remains in your private API and is not stored by Google."}
        </Body>
        {error ? <Message>{error}</Message> : null}
        <Button
          title={isWeb ? "Sign in with ChatGPT →" : "Continue with Google"}
          loading={isLoading}
          onPress={() => void signIn()}
        />
        {isWeb ? (
          <Button
            title="Check existing session"
            variant="ghost"
            compact
            disabled={isLoading}
            onPress={() => void retry()}
          />
        ) : null}
      </Card>
      <Body muted style={styles.footer}>
        {isWeb
          ? "This page is public; workout data and changes are available only after sign-in to an approved account."
          : "Authentication identifies the account; authorization is enforced again by the API on every request."}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: "center", minHeight: 600, maxWidth: 560 },
  mark: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.accent },
  markText: { color: colors.background, fontSize: 17, fontWeight: "900", letterSpacing: -0.5 },
  authCard: { marginTop: spacing.sm, padding: spacing.xl, gap: spacing.lg },
  footer: { fontSize: 11, lineHeight: 17 },
});

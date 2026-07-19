import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Body, Button, Eyebrow, Heading } from "../../components/ui";
import { colors, radii, spacing } from "../../theme/tokens";

export function DiscardWorkoutModal({
  visible,
  routineCode,
  recordedSets,
  discarding,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  routineCode: string;
  recordedSets: number;
  discarding: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keep workout in progress"
          disabled={discarding}
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <Eyebrow>Routine {routineCode}</Eyebrow>
          <Heading size="medium">Discard this workout?</Heading>
          <Body muted>
            This permanently deletes the in-progress workout
            {recordedSets
              ? ` and its ${recordedSets} recorded ${recordedSets === 1 ? "set" : "sets"}`
              : ""}
            . It will not appear in your active workouts or history, and this cannot
            be undone.
          </Body>
          <View style={styles.buttons}>
            <Button
              title={discarding ? "Discarding…" : "Discard workout"}
              variant="danger"
              loading={discarding}
              onPress={onConfirm}
            />
            <Button
              title="Keep workout"
              variant="secondary"
              disabled={discarding}
              onPress={onCancel}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: colors.overlay,
    paddingTop: spacing.xl,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  buttons: { gap: spacing.sm },
});

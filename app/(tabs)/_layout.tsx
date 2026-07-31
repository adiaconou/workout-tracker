import { Tabs } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii } from "../../src/theme/tokens";

type TabGlyphName = "routines" | "exercises" | "coach" | "history";

function TabLabel({ title, focused }: { title: string; focused: boolean }) {
  return <Text style={[styles.label, focused && styles.labelActive]}>{title}</Text>;
}

function TabGlyph({
  name,
  focused,
}: {
  name: TabGlyphName;
  focused: boolean;
}) {
  const tint = focused ? colors.accent : colors.textMuted;

  if (name === "routines") {
    return (
      <View accessible={false} style={styles.glyph}>
        <View style={[styles.routineLine, { backgroundColor: tint }]} />
        <View
          style={[
            styles.routineLine,
            styles.routineLineShort,
            { backgroundColor: tint },
          ]}
        />
        <View style={[styles.routineLine, { backgroundColor: tint }]} />
      </View>
    );
  }

  if (name === "exercises") {
    return (
      <View accessible={false} style={[styles.glyph, styles.dumbbell]}>
        <View style={[styles.dumbbellBar, { backgroundColor: tint }]} />
        <View
          style={[
            styles.dumbbellPlate,
            styles.dumbbellPlateLeft,
            { backgroundColor: tint },
          ]}
        />
        <View
          style={[
            styles.dumbbellPlate,
            styles.dumbbellPlateRight,
            { backgroundColor: tint },
          ]}
        />
      </View>
    );
  }

  if (name === "coach") {
    return (
      <View accessible={false} style={[styles.coachBubble, { borderColor: tint }]}>
        <View style={[styles.coachDot, { backgroundColor: tint }]} />
        <View style={[styles.coachDot, { backgroundColor: tint }]} />
        <View style={[styles.coachTail, { borderTopColor: tint }]} />
      </View>
    );
  }

  return (
    <View accessible={false} style={[styles.clock, { borderColor: tint }]}>
      <View style={[styles.clockHandHour, { backgroundColor: tint }]} />
      <View style={[styles.clockHandMinute, { backgroundColor: tint }]} />
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 8 : Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveBackgroundColor: colors.surfaceRaised,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: [
          styles.tabBar,
          {
            height: 64 + bottomPadding,
            paddingBottom: bottomPadding,
          },
        ],
        tabBarItemStyle: styles.tabItem,
        tabBarIconStyle: styles.iconSlot,
        tabBarLabelPosition: "below-icon",
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="routines"
        options={{
          title: "Routines",
          tabBarAccessibilityLabel: "Routines tab",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name="routines" focused={focused} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel title="Routines" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: "Exercises",
          tabBarAccessibilityLabel: "Exercises tab",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name="exercises" focused={focused} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel title="Exercises" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: "Coach",
          tabBarAccessibilityLabel: "Coach tab",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name="coach" focused={focused} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel title="Coach" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarAccessibilityLabel: "History tab",
          tabBarIcon: ({ focused }) => (
            <TabGlyph name="history" focused={focused} />
          ),
          tabBarLabel: ({ focused }) => (
            <TabLabel title="History" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 560,
    paddingTop: 6,
    paddingHorizontal: 6,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    ...Platform.select({
      web: {
        width: "96%",
        marginBottom: 10,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.lg,
      },
    }),
  },
  tabItem: {
    minHeight: 50,
    marginHorizontal: 3,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  iconSlot: {
    width: 24,
    height: 24,
    marginBottom: 1,
  },
  label: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  labelActive: { color: colors.accent },
  glyph: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  routineLine: {
    width: 18,
    height: 2,
    borderRadius: radii.pill,
  },
  routineLineShort: {
    width: 13,
    alignSelf: "flex-start",
    marginLeft: 2,
  },
  dumbbell: {
    flexDirection: "row",
  },
  dumbbellBar: {
    width: 18,
    height: 3,
    borderRadius: radii.pill,
  },
  dumbbellPlate: {
    position: "absolute",
    width: 4,
    height: 13,
    borderRadius: 2,
  },
  dumbbellPlateLeft: {
    left: 1,
  },
  dumbbellPlateRight: {
    right: 1,
  },
  coachBubble: {
    width: 22,
    height: 18,
    borderWidth: 2,
    borderRadius: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  coachDot: {
    width: 3,
    height: 3,
    borderRadius: radii.pill,
  },
  coachTail: {
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
  clock: {
    width: 21,
    height: 21,
    borderWidth: 2,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  clockHandHour: {
    position: "absolute",
    width: 2,
    height: 6,
    borderRadius: radii.pill,
    transform: [{ translateY: -2 }],
  },
  clockHandMinute: {
    position: "absolute",
    width: 6,
    height: 2,
    borderRadius: radii.pill,
    transform: [{ translateX: 2 }],
  },
});

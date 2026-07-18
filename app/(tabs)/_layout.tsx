import { Tabs } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { colors } from "../../src/theme/tokens";

function TabLabel({ title, focused }: { title: string; focused: boolean }) {
  return <Text style={[styles.label, focused && styles.labelActive]}>{title}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="routines"
        options={{
          title: "Routines",
          tabBarLabel: ({ focused }) => <TabLabel title="Routines" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: "Exercises",
          tabBarLabel: ({ focused }) => <TabLabel title="Exercises" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 58,
    paddingTop: 4,
    paddingBottom: 6,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
  },
  tabItem: { paddingVertical: 4 },
  label: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  labelActive: { color: colors.accent },
});

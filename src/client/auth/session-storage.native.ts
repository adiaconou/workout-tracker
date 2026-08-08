import * as SecureStore from "expo-secure-store";

const REFRESH_KEY = "workout-tracker.refresh-token";

export function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export function setRefreshToken(value: string) {
  return SecureStore.setItemAsync(REFRESH_KEY, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export function deleteRefreshToken() {
  return SecureStore.deleteItemAsync(REFRESH_KEY);
}

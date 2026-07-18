import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
} from "react-native-nitro-google-signin";

let configured = false;

function configure() {
  if (configured) return;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    throw new Error("Google sign-in is not configured for this Android build.");
  }
  GoogleOneTapSignIn.configure({
    webClientId,
    offlineAccess: false,
    autoSelectOnSignIn: false,
  });
  configured = true;
}

export async function signInWithGoogle() {
  configure();
  await GoogleOneTapSignIn.checkPlayServices();
  let response = await GoogleOneTapSignIn.signIn();
  if (isNoSavedCredentialFoundResponse(response)) {
    response = await GoogleOneTapSignIn.createAccount();
  }
  if (isNoSavedCredentialFoundResponse(response)) {
    response = await GoogleOneTapSignIn.presentExplicitSignIn();
  }
  if (isCancelledResponse(response)) {
    throw new Error("Google sign-in was cancelled.");
  }
  if (!isSuccessResponse(response) || !response.data.idToken) {
    throw new Error("Google did not return a verifiable identity token.");
  }
  return response.data.idToken;
}

export async function signOutFromGoogle() {
  configure();
  await GoogleOneTapSignIn.signOut();
}

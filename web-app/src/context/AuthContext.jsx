import { createContext, useContext, useEffect, useState } from "react";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { homePathByRole } from "../lib/roles";

// Matches the user_role enum in database/schema/001_initial_schema.sql
const ROLES = ["botanist", "conservation_officer", "admin"];

const SIGN_IN_AGAIN_MESSAGE =
  "Please sign out, sign back in and try changing your password again.";
const CHANGE_PASSWORD_FAILED_MESSAGE =
  "Your password could not be changed. Please try again.";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // undefined until Supabase has finished restoring any saved session
  const [session, setSession] = useState(undefined);
  // Kept with the user it was loaded for, so one user's profile never carries over to the next
  const [loadedProfile, setLoadedProfile] = useState(null);
  const [error, setError] = useState(null);
  // Whether anyone has had a session since this page loaded. ProtectedRoute uses it to tell a
  // deep link from a sign-out. Kept in memory only, so a fresh page load starts as false.
  const [signedInThisVisit, setSignedInThisVisit] = useState(false);

  useEffect(() => {
    // Fires INITIAL_SESSION straight away with the saved session (or null), then again on
    // every sign-in, sign-out and token refresh
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) setSignedInThisVisit(true);
      if (!nextSession) setLoadedProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // Looked up here rather than inside the onAuthStateChange callback, which Supabase asks to keep
  // quick because a slow callback holds up every later auth event
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return;

        const role = ROLES.includes(data?.role) ? data.role : null;
        setLoadedProfile({ userId, role, fullName: data?.full_name ?? null });
        if (homePathByRole[role]) {
          setError(null);
          return;
        }

        // Checked here rather than only in ProtectedRoute because signing in happens on the
        // login page, outside any protected route. Botanists (and accounts without a role)
        // are signed straight back out, and the reason is shown on the login page.
        if (role) {
          setError(
            "This dashboard is for conservation officers and admins. Botanists should use the Niah Biodiversity mobile app.",
          );
        } else if (queryError) {
          setError(
            "Your account could not be loaded. Check your connection and try again.",
          );
        } else {
          setError(
            "This account has no role assigned yet. Ask an administrator to set one up.",
          );
        }
        supabase.auth.signOut({ scope: "local" });
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function signIn(email, password) {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) setError(signInErrorMessage(signInError));
  }

  // Resolves to { data, error }, with error a message ready to show. Doesn't touch the `error` above,
  // which is what the login page shows. A successful check replaces the session with a new one.
  async function changePassword(currentPassword, newPassword) {
    const email = session?.user.email;
    if (!email) return { data: null, error: SIGN_IN_AGAIN_MESSAGE };

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (verifyError) {
        console.error("Could not verify current password:", verifyError);
        return { data: null, error: changePasswordErrorMessage(verifyError) };
      }

      const { data, error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        console.error("Could not update password:", updateError);
        return { data: null, error: changePasswordErrorMessage(updateError) };
      }
      return { data: data.user, error: null };
    } catch (unexpected) {
      console.error("Could not change password:", unexpected);
      return { data: null, error: CHANGE_PASSWORD_FAILED_MESSAGE };
    }
  }

  // Only signs out this browser; any other devices the user is signed in on stay signed in
  function signOut() {
    return supabase.auth.signOut({ scope: "local" });
  }

  const profileLoaded = loadedProfile?.userId === userId;

  const value = {
    user: session?.user ?? null,
    role: profileLoaded ? loadedProfile.role : null,
    fullName: profileLoaded ? loadedProfile.fullName : null,
    // True until we know whether anyone is signed in and, if so, what their role is
    isLoading: session === undefined || (userId !== null && !profileLoaded),
    // Why the last sign-in attempt failed, or why the user was signed out
    error,
    signedInThisVisit,
    signIn,
    signOut,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}

function signInErrorMessage(error) {
  if (isAuthRetryableFetchError(error)) {
    return "Unable to reach the server. Check your connection and try again.";
  }
  if (isAuthApiError(error) && error.code === "invalid_credentials") {
    return "Incorrect email or password.";
  }
  return error.message;
}

function changePasswordErrorMessage(error) {
  if (isAuthRetryableFetchError(error)) {
    return "Unable to reach the server. Check your connection and try again.";
  }
  if (isAuthSessionMissingError(error)) return SIGN_IN_AGAIN_MESSAGE;
  if (error.status === 429)
    return "Too many attempts. Wait a few minutes and try again.";

  switch (error.code) {
    case "invalid_credentials":
      return "Current password is incorrect.";
    case "same_password":
      return "New password must be different from your current password.";
    case "weak_password":
      return "That password is too weak. Choose a longer one that mixes letters, numbers and symbols.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return SIGN_IN_AGAIN_MESSAGE;
    default:
      return CHANGE_PASSWORD_FAILED_MESSAGE;
  }
}

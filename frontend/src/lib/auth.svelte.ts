import { browser } from "$app/environment";

export type UserRole = "admin" | "user";

export interface AuthSessionUser {
  id?: string;
  username: string;
  name: string;
  role: UserRole;
  avatar?: string | null;
  permissions?: string[] | string | null;
  onboarded?: number;
}

const STORAGE_KEY = "wafmgmt:auth_session";
const USER_KEY = "wafmgmt:auth_user";

function getInitialState(): { isLoggedIn: boolean; user: AuthSessionUser } {
  if (browser && typeof window !== "undefined" && window.localStorage) {
    const isLoggedIn = window.localStorage.getItem(STORAGE_KEY) === "1";
    let user: AuthSessionUser = { username: "admin", name: "Administrator", role: "admin" };
    try {
      const stored = window.localStorage.getItem(USER_KEY);
      if (stored) user = JSON.parse(stored);
    } catch {}
    return { isLoggedIn, user };
  }
  return {
    isLoggedIn: false,
    user: { username: "admin", name: "Administrator", role: "admin" }
  };
}

const initial = getInitialState();

export const authState = $state<{
  isLoggedIn: boolean;
  user: AuthSessionUser;
}>({
  isLoggedIn: initial.isLoggedIn,
  user: initial.user
});

export function login(userData: AuthSessionUser): void {
  authState.isLoggedIn = true;
  authState.user = userData;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, "1");
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  }
}

export function updateUserState(partial: Partial<AuthSessionUser>): void {
  authState.user = { ...authState.user, ...partial };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(USER_KEY, JSON.stringify(authState.user));
  }
}

export function logout(): void {
  authState.isLoggedIn = false;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

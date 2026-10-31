"use client";

import { get, post, ApiError } from "@/lib/api";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Role = "admin" | "staff" | "customer";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await get<{ user: SessionUser }>("/auth/me");
      setUser(me.user);
    } catch (e) {
      // Not logged in — 401 is expected; anything else still signs out client-side.
      setUser(null);
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 403))) throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await post("/auth/logout", {});
    } catch {
      // Cookie already gone — treat as logged out.
    }
    setUser(null);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function isStaff(role: Role | undefined): boolean {
  return role === "admin" || role === "staff";
}

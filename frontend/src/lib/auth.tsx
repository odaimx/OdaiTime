import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { session, setOnSessionExpired, type Usuario } from "./api";

interface AuthState {
  usuario: Usuario | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(() => session.get()?.usuario ?? null);

  useEffect(() => setOnSessionExpired(() => setUsuario(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      throw new Error(
        typeof body?.detail === "string" ? body.detail : "No se pudo iniciar sesión",
      );
    }
    session.set(body);
    setUsuario(body.usuario);
  }, []);

  const logout = useCallback(async () => {
    const current = session.get();
    session.clear();
    setUsuario(null);
    if (current) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      }).catch(() => {});
    }
  }, []);

  return <AuthContext.Provider value={{ usuario, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}

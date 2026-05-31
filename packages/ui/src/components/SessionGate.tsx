import React, { useEffect, useState } from "react";
import {
  clearRuntimeToken,
  consumeRuntimeTokenFromUrl,
  readRuntimeToken,
  writeRuntimeToken,
  type RuntimeTokenPersistence
} from "@northline/shared";
import { Button } from "./Button";
import { Icon } from "./Icon";

export interface NorthlineSession {
  tenant_id: string;
  actor_id: string;
  role: string;
  capabilities?: string[];
  issued_at?: string;
}

export interface SessionGateProps {
  appName: string;
  defaultDevToken?: string;
  getAuthConfig?: () => Promise<AuthProviderConfig>;
  getSession: () => Promise<NorthlineSession>;
  children: React.ReactNode;
}

export interface AuthProviderConfig {
  enabled: boolean;
  login_url: string | null;
  client_id?: string | null;
  scopes?: string | null;
}

type SessionState =
  | { status: "checking" }
  | { status: "ready"; session: NorthlineSession }
  | { status: "signed_out"; message?: string };

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  color: "var(--ink)",
  background:
    "radial-gradient(circle at 16% 12%, rgba(56, 189, 248, 0.12), transparent 32rem), linear-gradient(180deg, var(--bg) 0%, #050b14 100%)"
};

const panelStyle: React.CSSProperties = {
  width: "min(440px, 100%)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  background: "var(--glass-bg)",
  boxShadow: "var(--glass-shadow)",
  padding: "24px"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "46px",
  border: "1px solid var(--line)",
  borderRadius: "8px",
  background: "var(--bg-soft)",
  color: "var(--ink)",
  padding: "10px 12px",
  font: "inherit"
};

function SessionForm({
  appName,
  defaultToken,
  authConfig,
  message,
  onSubmit
}: {
  appName: string;
  defaultToken?: string;
  authConfig?: AuthProviderConfig | null;
  message?: string;
  onSubmit: (token: string, persistence: RuntimeTokenPersistence) => void;
}) {
  const [token, setToken] = useState(defaultToken ?? "");
  const [remember, setRemember] = useState(false);

  return (
    <main style={shellStyle}>
      <form
        style={panelStyle}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(token.trim(), remember ? "local" : "session");
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <Icon name="ShieldCheck" size={32} />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>{appName}</h1>
            <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 14 }}>Northline secure session</p>
          </div>
        </div>

        {authConfig?.enabled && authConfig.login_url ? (
          <Button
            type="button"
            fullWidth
            leftIcon={<Icon name="ShieldCheck" size={16} />}
            onClick={() => window.location.assign(authConfig.login_url as string)}
          >
            Sign in with identity provider
          </Button>
        ) : null}

        <label htmlFor="northline-session-token" style={{ display: "block", color: "var(--ink-soft)", marginTop: 16, marginBottom: 8 }}>
          Session token
        </label>
        <input
          id="northline-session-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          style={inputStyle}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, color: "var(--ink-soft)" }}>
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Keep this session on this device
        </label>

        {message ? <p style={{ color: "var(--danger)", margin: "14px 0 0" }}>{message}</p> : null}

        <Button type="submit" fullWidth style={{ marginTop: 18 }} disabled={!token.trim()}>
          Continue
        </Button>
      </form>
    </main>
  );
}

export function SessionGate({ appName, defaultDevToken, getAuthConfig, getSession, children }: SessionGateProps) {
  const [state, setState] = useState<SessionState>({ status: "checking" });
  const [authConfig, setAuthConfig] = useState<AuthProviderConfig | null>(null);

  async function verify() {
    try {
      const session = await getSession();
      setState({ status: "ready", session });
    } catch {
      clearRuntimeToken();
      setState({ status: "signed_out", message: "Session could not be verified." });
    }
  }

  useEffect(() => {
    const redirected = consumeRuntimeTokenFromUrl("session");
    const stored = redirected ?? readRuntimeToken();
    if (!stored && defaultDevToken) {
      writeRuntimeToken(defaultDevToken, "session");
    }

    if (stored || defaultDevToken) {
      void verify();
    } else {
      setState({ status: "signed_out" });
    }
  }, [defaultDevToken]);

  useEffect(() => {
    if (!getAuthConfig) return;

    let mounted = true;
    getAuthConfig()
      .then((config) => {
        if (mounted) setAuthConfig(config);
      })
      .catch(() => {
        if (mounted) setAuthConfig(null);
      });

    return () => {
      mounted = false;
    };
  }, [getAuthConfig]);

  if (state.status === "checking") {
    return (
      <main style={shellStyle}>
        <div style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="RefreshCw" size={24} spin />
          <span>Verifying session</span>
        </div>
      </main>
    );
  }

  if (state.status === "signed_out") {
    return (
      <SessionForm
        appName={appName}
        defaultToken={defaultDevToken}
        authConfig={authConfig}
        message={state.message}
        onSubmit={(token, persistence) => {
          writeRuntimeToken(token, persistence);
          setState({ status: "checking" });
          void verify();
        }}
      />
    );
  }

  return <>{children}</>;
}

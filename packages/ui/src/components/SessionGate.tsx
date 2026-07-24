import React, { useCallback, useEffect, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup } from "firebase/auth";
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
  firebaseConfig?: FirebaseClientConfig;
  getAuthConfig?: () => Promise<AuthProviderConfig>;
  getSession: () => Promise<NorthlineSession>;
  children: React.ReactNode;
}

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
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
  | { status: "offline"; message: string }
  | { status: "signed_out"; message?: string };

const shellStyle: React.CSSProperties = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  color: "var(--ink-primary)",
  background:
    "radial-gradient(circle at 16% 12%, rgba(56, 189, 248, 0.12), transparent 32rem), linear-gradient(180deg, var(--bg-primary) 0%, #050b14 100%)"
};

const panelStyle: React.CSSProperties = {
  width: "min(440px, 100%)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-glass)",
  boxShadow: "var(--shadow-lg)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  padding: "24px"
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "46px",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-secondary)",
  color: "var(--ink-primary)",
  padding: "10px 12px",
  font: "inherit"
};

function isNetworkError(error: unknown): boolean {
  return (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    error instanceof TypeError
  );
}

function SessionForm({
  appName,
  defaultToken,
  firebaseConfig,
  authConfig,
  message,
  onSubmit
}: {
  appName: string;
  defaultToken?: string;
  firebaseConfig?: FirebaseClientConfig;
  authConfig?: AuthProviderConfig | null;
  message?: string;
  onSubmit: (token: string, persistence: RuntimeTokenPersistence) => void;
}) {
  const [token, setToken] = useState(defaultToken ?? "");
  const [remember, setRemember] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    if (!firebaseConfig) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(getAuth(app), provider);
      onSubmit(await credential.user.getIdToken(), "local");
    } catch {
      setSignInError("Google sign-in did not complete. Please try again.");
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <main style={shellStyle}>
      <form
        style={panelStyle}
        className="animate-slide-in-up"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(token.trim(), remember ? "local" : "session");
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <Icon name="ShieldCheck" size={32} color="var(--accent-cyan)" />
          <div>
            <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>{appName}</h1>
            <p style={{ margin: "4px 0 0", color: "var(--ink-secondary)", fontSize: 14 }}>Northline secure session</p>
          </div>
        </div>

        {firebaseConfig ? (
          <Button type="button" fullWidth leftIcon={<Icon name="ShieldCheck" size={16} />} onClick={() => void signInWithGoogle()} disabled={signingIn}>
            {signingIn ? "Signing in…" : "Continue with Google"}
          </Button>
        ) : authConfig?.enabled && authConfig.login_url ? (
          <Button
            type="button"
            fullWidth
            leftIcon={<Icon name="ShieldCheck" size={16} />}
            onClick={() => window.location.assign(authConfig.login_url as string)}
          >
            Sign in with identity provider
          </Button>
        ) : null}

        {!firebaseConfig ? <><label htmlFor="northline-session-token" style={{ display: "block", color: "var(--ink-secondary)", marginTop: 16, marginBottom: 8 }}>
          Session token
        </label>
        <div style={{ position: "relative" }}>
          <input
            id="northline-session-token"
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, paddingRight: 44 }}
          />
          <button
            type="button"
            onClick={() => setShowToken((current) => !current)}
            aria-label={showToken ? "Hide session token" : "Show session token"}
            aria-pressed={showToken}
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              padding: 8,
              color: "var(--ink-muted)",
              borderRadius: "var(--radius-sm)"
            }}
          >
            <Icon name={showToken ? "EyeOff" : "Eye"} size={16} />
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, color: "var(--ink-secondary)" }}>
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Keep this session on this device
        </label>

        {message ? (
          <p role="alert" style={{ color: "var(--danger)", margin: "14px 0 0" }}>
            {message}
          </p>
        ) : null}

        <Button type="submit" fullWidth style={{ marginTop: 18 }} disabled={!token.trim()}>
          Continue
        </Button></> : null}

        {signInError ? <p role="alert" style={{ color: "var(--danger)", margin: "14px 0 0" }}>{signInError}</p> : null}
      </form>
    </main>
  );
}

export function SessionGate({ appName, defaultDevToken, firebaseConfig, getAuthConfig, getSession, children }: SessionGateProps) {
  const [state, setState] = useState<SessionState>({ status: "checking" });
  const [authConfig, setAuthConfig] = useState<AuthProviderConfig | null>(null);

  const verify = useCallback(async () => {
    try {
      const session = await getSession();
      setState({ status: "ready", session });
    } catch (error) {
      if (isNetworkError(error)) {
        // Keep the stored token: a connectivity blip on a vessel must not
        // sign the crew out of an offline-first app.
        setState({
          status: "offline",
          message: "Cannot reach the Northline API. Check connectivity and retry."
        });
        return;
      }
      clearRuntimeToken();
      setState({ status: "signed_out", message: "Session could not be verified. Enter a valid session token." });
    }
  }, [getSession]);

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
  }, [defaultDevToken, verify]);

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
        <div role="status" style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="RefreshCw" size={24} spin />
          <span>Verifying session</span>
        </div>
      </main>
    );
  }

  if (state.status === "offline") {
    return (
      <main style={shellStyle}>
        <div role="alert" style={{ ...panelStyle, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="AlertTriangle" size={24} color="var(--warning)" />
            <strong>Connection problem</strong>
          </div>
          <p style={{ margin: 0, color: "var(--ink-secondary)" }}>{state.message}</p>
          <div style={{ display: "flex", gap: 10 }}>
            <Button
              type="button"
              onClick={() => {
                setState({ status: "checking" });
                void verify();
              }}
            >
              Retry
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                clearRuntimeToken();
                setState({ status: "signed_out" });
              }}
            >
              Use a different token
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (state.status === "signed_out") {
    return (
      <SessionForm
        appName={appName}
        defaultToken={defaultDevToken}
        firebaseConfig={firebaseConfig}
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

import React from "react";
import ReactDOM from "react-dom/client";
import { readRuntimeToken } from "@northline/shared";
import { SessionGate } from "@northline/ui";
import { App } from "./App";
import { LandingExperience } from "./LandingExperience";
import { defaultDevToken, getAuthConfig, getSession } from "./lib/api";
import "./styles.css";

// Service worker registration is injected automatically by vite-plugin-pwa
// (injectRegister defaults to "auto" with registerType: "autoUpdate").

function WebPortalRoot() {
  const [showPortal, setShowPortal] = React.useState(() => (
    window.location.hash === "#portal" || Boolean(readRuntimeToken())
  ));

  React.useEffect(() => {
    const syncEntrySurface = () => {
      setShowPortal(window.location.hash === "#portal" || Boolean(readRuntimeToken()));
    };

    window.addEventListener("hashchange", syncEntrySurface);
    return () => window.removeEventListener("hashchange", syncEntrySurface);
  }, []);

  if (!showPortal) {
    return (
      <LandingExperience
        onEnterPortal={() => {
          window.location.hash = "portal";
          setShowPortal(true);
        }}
      />
    );
  }

  return (
    <SessionGate
      appName="Northline Command Portal"
      defaultDevToken={import.meta.env.DEV ? defaultDevToken : undefined}
      getAuthConfig={getAuthConfig}
      getSession={getSession}
    >
      <App />
    </SessionGate>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebPortalRoot />
  </React.StrictMode>
);

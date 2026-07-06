import React from "react";
import ReactDOM from "react-dom/client";
import { SessionGate } from "@northline/ui";
import { App } from "./App";
import { defaultDevToken, getAuthConfig, getSession } from "./lib/api";
import "./styles.css";

// Service worker registration is injected automatically by vite-plugin-pwa
// (injectRegister defaults to "auto" with registerType: "autoUpdate").

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionGate
      appName="Northline Command Portal"
      defaultDevToken={import.meta.env.DEV ? defaultDevToken : undefined}
      getAuthConfig={getAuthConfig}
      getSession={getSession}
    >
      <App />
    </SessionGate>
  </React.StrictMode>
);

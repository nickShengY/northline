import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { SessionGate } from "@northline/ui";
import { FieldOpsApp } from "./FieldOpsApp";
import { defaultDevToken, getAuthConfig, getSession } from "./lib/api";
import "./styles.css";

registerSW({
  immediate: true,
  onRegisterError(error: unknown) {
    console.error("PWA register error:", error);
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionGate
      appName="Northline Field Ops"
      defaultDevToken={import.meta.env.DEV ? defaultDevToken : undefined}
      getAuthConfig={getAuthConfig}
      getSession={getSession}
    >
      <FieldOpsApp />
    </SessionGate>
  </React.StrictMode>
);

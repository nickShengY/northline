import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { SessionGate } from "@northline/ui";
import { FieldOpsApp } from "./FieldOpsApp";
import { defaultDevToken, getAuthConfig, getSession } from "./lib/api";
import "./styles.css";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => typeof value === "string" && value.length > 0);

export interface PwaStatusDetail {
  type: "updated" | "offline-ready";
  message: string;
}

declare global {
  interface Window {
    __northlinePwaStatus?: PwaStatusDetail;
  }
}

function announcePwaStatus(detail: PwaStatusDetail) {
  // Buffer the latest status so the app can pick it up if the service worker
  // reports before FieldOpsApp mounts its listener (SessionGate can delay it).
  window.__northlinePwaStatus = detail;
  window.dispatchEvent(new CustomEvent<PwaStatusDetail>("northline:pwa-status", { detail }));
}

registerSW({
  immediate: true,
  onNeedRefresh() {
    // registerType is autoUpdate, so this only fires if auto-activation is
    // blocked; surface it so the user knows a reload gets the new version.
    announcePwaStatus({ type: "updated", message: "App updated. Reload to get the latest version." });
  },
  onOfflineReady() {
    announcePwaStatus({ type: "offline-ready", message: "App is ready to work offline." });
  },
  onRegisterError(error: unknown) {
    console.error("PWA register error:", error);
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionGate
      appName="Northline Field Ops"
      defaultDevToken={import.meta.env.DEV ? defaultDevToken : undefined}
      firebaseConfig={hasFirebaseConfig ? firebaseConfig : undefined}
      getAuthConfig={getAuthConfig}
      getSession={getSession}
    >
      <FieldOpsApp />
    </SessionGate>
  </React.StrictMode>
);

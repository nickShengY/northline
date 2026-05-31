import React from "react";
import ReactDOM from "react-dom/client";
import { SessionGate } from "@northline/ui";
import { App } from "./App";
import { defaultDevToken, getAuthConfig, getSession } from "./lib/api";
import "./styles.css";

// Vite serves index.html for /sw.js in dev, so only register the generated worker in production.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("SW registered:", registration.scope);
      })
      .catch((error) => {
        console.log("SW registration failed:", error);
      });
  });
}

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

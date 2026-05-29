import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { FieldOpsApp } from "./FieldOpsApp";
import "./styles.css";

registerSW({
  immediate: true,
  onRegisterError(error: unknown) {
    console.error("PWA register error:", error);
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FieldOpsApp />
  </React.StrictMode>
);

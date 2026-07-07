import React from "react";
import ReactDOM from "react-dom/client";
import { OffshoreApp } from "./OffshoreApp";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OffshoreApp />
  </React.StrictMode>
);

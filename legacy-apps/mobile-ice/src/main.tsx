import React from "react";
import ReactDOM from "react-dom/client";
import { IceApp } from "./IceApp";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IceApp />
  </React.StrictMode>
);

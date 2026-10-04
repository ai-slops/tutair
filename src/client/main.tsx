import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

if (import.meta.env.DEV && import.meta.env["VITE_DISABLE_REACT_DEVTOOLS"] !== "1") {
  await import("react-grab");
  const { scan } = await import("react-scan");
  scan({ enabled: true, showToolbar: false });
}

const root = document.getElementById("root");
if (root === null) {
  throw new DOMException("Tutair root element is missing", "InvalidStateError");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

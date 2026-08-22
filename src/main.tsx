import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./lib/push-notifications";

// A new build shipped while this tab was open: Vite's modulepreload of a now-missing chunk
// fires "vite:preloadError". Swallow it so it doesn't surface as an uncaught error — the
// actual recovery (a single silent reload) happens in lazyWithRetry when a route is opened.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
});

// Register service worker for push notifications (only on published domains)
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);

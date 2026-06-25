import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./lib/push-notifications";

// Register service worker for push notifications (only on published domains)
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);

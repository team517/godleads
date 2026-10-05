import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Vendors that get their own chunk so the first load downloads them IN PARALLEL (HTTP/2) and they
// stay CACHED across app deploys (only app code re-downloads).
const REACT_VENDOR = new Set(["react", "react-dom", "scheduler", "react-router", "react-router-dom", "@remix-run/router"]);
const RADIX = new Set([
  "@radix-ui/react-dialog",
  "@radix-ui/react-popover",
  "@radix-ui/react-tabs",
  "@radix-ui/react-select",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-tooltip",
]);

/** Package name of a node_modules module id ("@scope/name" or "name"), or null for app code. */
export function packageOf(id: string): string | null {
  const p = id.replace(/\\/g, "/");
  const m = p.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
  return m ? m[1] : null;
}

/** Function form: EVERY module of the package lands in the chunk (the object form only caught the
 *  package entry, so react-dom's real code — cjs/react-dom.production.min.js — ended up in the
 *  app's index chunk and re-downloaded on every deploy). */
export function chunkFor(id: string): string | undefined {
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  if (REACT_VENDOR.has(pkg)) return "react-vendor";
  if (pkg.startsWith("@supabase/")) return "supabase";
  if (RADIX.has(pkg)) return "radix";
  return undefined;
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        manualChunks: chunkFor,
      },
    },
  },
}));

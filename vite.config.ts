import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
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
        // Split the big stable vendors into their own chunks so the first load
        // downloads them IN PARALLEL (HTTP/2) instead of one 700KB file, and so
        // they stay CACHED across app deploys (only app code re-downloads).
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "supabase": ["@supabase/supabase-js"],
          "query": ["@tanstack/react-query"],
          "radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-popover",
            "@radix-ui/react-tabs",
            "@radix-ui/react-select",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
  },
}));

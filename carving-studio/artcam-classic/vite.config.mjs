import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {modelBridge} from './bridge.mjs';

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
    strictPort: true,
    allowedHosts: ["127.0.0.1"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), modelBridge()],
});

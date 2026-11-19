import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["pdf-lib", "fflate"] },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
});

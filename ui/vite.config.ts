import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// The whole panel is one index.html; the firmware serves it gzipped (scripts/prebuild.py).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  // npm run dev against a real sensor: SENSE_DEVICE_URL=http://<sensor ip> npm run dev
  const deviceUrl = env.SENSE_DEVICE_URL
  if (mode === "development" && !deviceUrl) console.warn("SENSE_DEVICE_URL is not set - the panel has no sensor to talk to.")
  return {
    define: { __VERSION__: JSON.stringify(process.env.WHISLI_SENSE_VERSION ?? "dev") },
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
    server: { proxy: deviceUrl ? { "/api": { target: deviceUrl, changeOrigin: true, ws: true } } : undefined },
    build: { outDir: "dist", emptyOutDir: true },
  }
})

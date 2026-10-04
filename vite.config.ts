import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
  test: { exclude: [...configDefaults.exclude, "tests/browser/**"] },
});

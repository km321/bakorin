import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  base: "/admin/",
  server: {
    port: 4372,
    proxy: {
      "/api": "http://127.0.0.1:4371",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

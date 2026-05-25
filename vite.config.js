import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  publicDir: "../src-tauri/icons",
  envDir: "../",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/firebase")) return "firebase";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});

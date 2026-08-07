import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8766",
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // 资源 base path：本地开发默认 "/"；Docker 构建时通过 VITE_BASE 指定子路径
  // （如 /dashboard/，见 Dockerfile ARG VITE_BASE），使静态资源引用带上前缀
  base: process.env.VITE_BASE ?? "/",
  server: {
    host: "127.0.0.1",
    port: 8765,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 8765,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/echarts/") ||
            id.includes("/node_modules/zrender/")
          ) {
            return "charts-vendor";
          }
          if (id.includes("/node_modules/html-to-image/")) {
            return "export-vendor";
          }
          if (id.includes("/node_modules/svelte/")) {
            return "svelte-vendor";
          }
        },
      },
    },
  },
});

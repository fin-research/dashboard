import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8766",
    changeOrigin: false,
    rewrite: (path: string) => path.replace(/^\/api(?=\/|$)/, ""),
  },
};

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  // 子路径部署：静态资源统一挂在 /dashboard/ 下（部署时由反向代理剥离前缀）。
  // 本地开发与构建产物均带此前缀，访问入口为 http://127.0.0.1:8765/dashboard/
  base: "/dashboard/",
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

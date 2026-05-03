import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      injectRegister: false,
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "robots.txt"],
      manifest: {
        name: "NanthAI Edge",
        short_name: "NanthAI",
        description: "Your personal AI — multi-model, agentic, always sharp.",
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/app",
        scope: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB — covers brand images
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2,png,webmanifest}"],
        globIgnores: ["**/edge-brand/**", "**/screenshots/**"],
        importScripts: ["push-sw.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/openrouter\/edge\/callback/,
          /^\/privacy/,
          /^\/terms/,
          /^\/support/,
          /^\/sitemap/,
          /^\/llms/,
          /^\/stripe-webhook/,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "app-pages",
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Cache Convex API requests. Matches any *.convex.cloud origin so
            // self-hosters don't need to edit this. Note: if the browser somehow
            // encounters another Convex deployment's URL it would also be cached.
            urlPattern: /^https:\/\/.*\.convex\.cloud\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "convex-api",
              networkTimeoutSeconds: 5,
            },
          },
        ],
        offlineGoogleAnalytics: false,
      },
      devOptions: {
        enabled: true,
        suppressWarnings: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex/_generated/api": path.resolve(__dirname, "./src/lib/convexApi.ts"),
    },
  },
  build: {
    // Raise warning threshold — ChatPage bundles markdown + syntax highlighting
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split heavy vendor libs into separate cacheable chunks.
        manualChunks(id: string) {
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "vendor-recharts";
          }
          if (
            id.includes("node_modules/react-markdown") ||
            id.includes("node_modules/rehype") ||
            id.includes("node_modules/remark") ||
            id.includes("node_modules/katex") ||
            id.includes("node_modules/unified") ||
            id.includes("node_modules/mdast") ||
            id.includes("node_modules/hast") ||
            id.includes("node_modules/vfile") ||
            id.includes("node_modules/micromark") ||
            id.includes("node_modules/highlight.js")
          ) {
            return "vendor-markdown";
          }
          if (id.includes("node_modules/@clerk")) {
            return "vendor-clerk";
          }
          if (id.includes("node_modules/convex")) {
            return "vendor-convex";
          }
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react-router")) {
            return "vendor-react";
          }
        },
      },
    },
  },
});

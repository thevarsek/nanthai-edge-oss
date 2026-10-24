import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { copyFile } from "node:fs/promises";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "private-app-shell",
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          // Match production's private rewrites when exercising the built preview.
          if (/^\/(?:app|sign-in|sign-up|onboarding|oauth)(?:\/|$)|^\/openrouter\/callback(?:\/|$)|^\/mobile-drive-picker(?:\/|$)|^\/(?:runtime\/connect|mcp\/authorize|openrouter-required)(?:\/|$)/.test((request.url ?? "").split("?")[0])) {
            request.url = "/app-shell.html";
          }
          next();
        });
      },
      async writeBundle(options) {
        // Preserve the SPA entry before public prerendering replaces the home document.
        const output = options.dir ?? "dist";
        await copyFile(path.join(output, "index.html"), path.join(output, "app-shell.html"));
      },
    },
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
        // `injectRegister: false` means vite-plugin-pwa does not infer these
        // from `registerType: "autoUpdate"`. Set them explicitly so a newly
        // deployed worker replaces the previous PWA shell immediately.
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB — covers brand images
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2,png,webmanifest}"],
        globIgnores: ["**/edge-brand/**", "**/screenshots/**"],
        importScripts: ["push-sw.js"],
        navigateFallback: "/app-shell.html",
        navigateFallbackDenylist: [
          /^\/openrouter\/edge\/callback/,
          /^\/privacy/,
          /^\/terms/,
          /^\/support/,
          /^\/sitemap/,
          /^\/llms/,
          /^\/guides(?:\/|$)/,
          /^\/research(?:\/|$)/,
          /^\/stripe-webhook/,
        ],
        runtimeCaching: [
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
    alias: [
      {
        find: "@convex/_generated/api",
        replacement: path.resolve(__dirname, "./src/lib/convexApi.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        // dom-to-pptx imports a default export that opentype.js v2's ESM
        // build does not expose. Its UMD build supplies the expected shape.
        find: /^opentype\.js$/,
        replacement: "opentype.js/dist/opentype.js",
      },
    ],
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

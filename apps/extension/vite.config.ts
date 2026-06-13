import { defineConfig } from "vite";
import { createRequire } from "node:module";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./manifest.config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);

// The node-polyfills plugin rewrites bare `Buffer`/`process` references inside
// workspace packages (e.g. @casper-baret/casper-core's dist) to its own shim
// specifiers. Under pnpm those specifiers don't resolve from the importing
// package's isolated node_modules, so alias them to absolute paths here.
const shim = (name: string) =>
  require.resolve(`vite-plugin-node-polyfills/shims/${name}`);

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    nodePolyfills({ include: ["buffer", "crypto"] }),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      "vite-plugin-node-polyfills/shims/buffer": shim("buffer"),
      "vite-plugin-node-polyfills/shims/global": shim("global"),
      "vite-plugin-node-polyfills/shims/process": shim("process"),
    },
  },
  build: {
    outDir: mode === "firefox" ? "dist-firefox" : "dist",
    emptyOutDir: true,
    rollupOptions: {
      // Inpage script needs a STABLE filename so the content script can inject it
      // by name and so the manifest's web_accessible_resources line stays valid
      // across rebuilds. Without this, crxjs ships the raw .ts source path which
      // the browser can't execute (bare module specifiers don't resolve at runtime),
      // and our Wallet Standard registration silently fails.
      input: {
        inpage: resolve(__dirname, "src/inpage/index.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "inpage") return "inpage.js";
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
  server: {
    port: 5181,
    strictPort: true,
    hmr: {
      port: 5182,
    },
  },
}));

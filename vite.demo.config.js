import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./demo", import.meta.url)),
  base: "/AlienCharts/",
  build: {
    outDir: `${projectRoot}pages-dist`,
    emptyOutDir: true,
  },
});

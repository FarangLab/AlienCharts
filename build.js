import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "esm",
  sourcemap: true,
  target: "es2020",
  logLevel: "info",
};

await Promise.all([
  build({ ...shared, entryPoints: ["src/index.js"], outfile: "dist/index.js" }),
  build({
    ...shared,
    entryPoints: ["src/vanilla/index.js"],
    outfile: "dist/vanilla.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/react/index.js"],
    outfile: "dist/react.js",
    external: ["react"],
    jsx: "automatic",
  }),
]);

import { build } from "esbuild";

// react, react-dom and @phosphor-icons/react stay external so consumers
// supply their own copy (react/react-dom are peers, phosphor a dependency).
const external = ["react", "react-dom", "@phosphor-icons/react"];

const shared = {
  entryPoints: ["src/index.js"],
  bundle: true,
  external,
  sourcemap: true,
  target: "es2020",
  logLevel: "info",
};

await Promise.all([
  build({ ...shared, format: "esm", outfile: "dist/index.js" }),
  build({ ...shared, format: "cjs", outfile: "dist/index.cjs" }),
]);

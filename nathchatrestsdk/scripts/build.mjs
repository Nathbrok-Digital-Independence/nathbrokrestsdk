import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = resolve(packageDir, "..");
const entryPoint = resolve(packageDir, "src", "index.js");
const source = readFileSync(entryPoint, "utf8");
const input = {
  absWorkingDir: packageDir,
  stdin: { contents: source, resolveDir: packageDir, sourcefile: "src/index.js", loader: "js" },
  bundle: true,
};

await Promise.all([
  build({
    ...input,
    format: "esm",
    target: "es2020",
    outfile: resolve(packageDir, "dist", "nathchatrestsdk.esm.js"),
  }),
  build({
    ...input,
    format: "iife",
    globalName: "NathChat",
    minify: true,
    target: "es2020",
    outfile: resolve(packageDir, "dist", "nathchatrestsdk.min.js"),
  }),
  build({
    ...input,
    format: "iife",
    globalName: "NathChat",
    minify: true,
    target: "es2020",
    outfile: resolve(repositoryDir, "static", "nathchatrestsdk.js"),
  }),
]);

import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = resolve(packageDir, "..");
const entryPoint = resolve(packageDir, "src", "index.js");
const source = readFileSync(entryPoint, "utf8");
const iconPath = resolve(packageDir, "assets", "NathChat.png");
const iconDataUrl = `data:image/png;base64,${readFileSync(iconPath).toString("base64")}`;
const iconModule = resolve(packageDir, "src", "nathchat-icon.js");
writeFileSync(iconModule, `export default ${JSON.stringify(iconDataUrl)};\n`);
const iconImport = 'import nathChatIconUrl from "./nathchat-icon.js";';
if (!source.includes(iconImport)) throw new Error("NathChat icon import is missing from the SDK source.");
const bundledSource = source.replace(iconImport, `const nathChatIconUrl = ${JSON.stringify(iconDataUrl)};`);
const input = {
  absWorkingDir: packageDir,
  stdin: { contents: bundledSource, resolveDir: packageDir, sourcefile: "src/index.js", loader: "js" },
  bundle: true,
};

const builds = [
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
];

// In the full Nathbrok workspace, Django serves the root static bundle from /nathchatrestsdk.js.
const websiteStaticDir = resolve(repositoryDir, "..", "static");
if (existsSync(websiteStaticDir)) {
  builds.push(build({
    ...input,
    format: "iife",
    globalName: "NathChat",
    minify: true,
    target: "es2020",
    outfile: resolve(websiteStaticDir, "nathchatrestsdk.js"),
  }));
}

await Promise.all(builds);

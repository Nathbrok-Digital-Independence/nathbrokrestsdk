import { readFileSync } from "node:fs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const parsed = JSON.parse(input);
  const pack = Array.isArray(parsed)
    ? parsed[0]
    : Array.isArray(parsed?.files)
      ? parsed
      : Object.values(parsed ?? {})[0];
  if (!pack || !Array.isArray(pack.files)) {
    throw new Error("npm pack did not return a package file list");
  }
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const files = pack.files.map(file => file.path);
  const allowed = /^(package\.json|README\.md|LICENSE|src\/.+)$/;
  const unexpected = files.filter(file => !allowed.test(file));
  const required = ["package.json", "README.md", "LICENSE", "src/index.js"];
  const missing = required.filter(file => !files.includes(file));
  const entrypoints = ["main", "module"].filter(
    field => packageJson[field] !== "./src/index.js",
  );
  const invalidExports = packageJson.exports?.["."] !== "./src/index.js";

  if (unexpected.length || missing.length || entrypoints.length || invalidExports) {
    throw new Error(
      `Unexpected package files: ${unexpected.join(", ") || "none"}; ` +
      `missing required files: ${missing.join(", ") || "none"}; ` +
      `invalid entrypoints: ${[...entrypoints, ...(invalidExports ? ["exports[.]"] : [])].join(", ") || "none"}`
    );
  }

  console.log(`Package contents verified (${files.length} files).`);
});

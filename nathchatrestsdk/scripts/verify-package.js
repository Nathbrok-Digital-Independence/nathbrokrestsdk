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
  const allowed = /^(package\.json|README\.md|LICENSE|index\.d\.ts|dist\/.+)$/;
  const unexpected = files.filter(file => !allowed.test(file));
  const required = [
    "package.json",
    "README.md",
    "LICENSE",
    "index.d.ts",
    "dist/nathchatrestsdk.esm.js",
    "dist/nathchatrestsdk.min.js",
  ];
  const missing = required.filter(file => !files.includes(file));
  const expectedEntrypoint = "./dist/nathchatrestsdk.esm.js";
  const invalidEntrypoints = ["main", "module"].filter(
    field => packageJson[field] !== expectedEntrypoint,
  );
  const invalidTypes = packageJson.types !== "./index.d.ts";
  const invalidExports = packageJson.exports?.["."]?.import !== expectedEntrypoint ||
    packageJson.exports?.["."]?.types !== "./index.d.ts" ||
    packageJson.exports?.["./browser"] !== "./dist/nathchatrestsdk.min.js";

  if (unexpected.length || missing.length || invalidEntrypoints.length || invalidTypes || invalidExports) {
    throw new Error(
      `Unexpected package files: ${unexpected.join(", ") || "none"}; ` +
      `missing required files: ${missing.join(", ") || "none"}; ` +
      `invalid metadata: ${[...invalidEntrypoints, ...(invalidTypes ? ["types"] : []), ...(invalidExports ? ["exports"] : [])].join(", ") || "none"}`
    );
  }

  console.log(`Package contents verified (${files.length} files).`);
});

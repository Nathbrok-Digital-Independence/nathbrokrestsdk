// Prints the Subresource Integrity hash for the CDN/script-tag build.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const file = new URL("../dist/nathchatsdk.min.js", import.meta.url);
const hash = createHash("sha384").update(readFileSync(file)).digest("base64");
console.log(`integrity="sha384-${hash}" crossorigin="anonymous"`);

import { createRequire } from "node:module";
import { validateDeploymentConfig } from "../lib/deployment-config.mjs";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const { errors, warnings } = validateDeploymentConfig(process.env);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);

if (errors.length > 0) {
  console.error(`Deployment configuration failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.log("Deployment configuration checks passed.");
}

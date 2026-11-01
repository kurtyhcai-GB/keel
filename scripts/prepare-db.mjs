import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("data/uploads", { recursive: true });

execSync("npx prisma db push", {
  stdio: "inherit",
  env: process.env,
});

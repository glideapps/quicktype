import * as fs from "fs";
import { spawnSync } from "child_process";

const pkg = require("./package.in.json");

function writePackage(core: string): void {
  pkg["dependencies"]["quicktype-core"] = core;
  fs.writeFileSync("package.json", JSON.stringify(pkg, undefined, 4));
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) {
    console.log(result.error);
    process.exit(1);
  }
}

try {
  writePackage("file:../quicktype-core");
  run("npm", ["install"]);
  writePackage("^0.0.6");
  run("npm", ["publish"]);
} catch (e) {
  console.log(e);
  process.exit(1);
} finally {
  try {
    fs.unlinkSync("package.json");
  } catch {}
}

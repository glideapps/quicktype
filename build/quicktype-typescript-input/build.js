"use strict";

const fs = require("fs");
const path = require("path");
const spawnSync = require("child_process").spawnSync;

const pkg = require("./package.in.json");

function mapFile(source, destination, transform) {
  const content = fs.readFileSync(source, "utf8");
  fs.writeFileSync(destination, transform(content));
}

function writePackage(core) {
  pkg["dependencies"]["quicktype-core"] = core;
  fs.writeFileSync("package.json", JSON.stringify(pkg, undefined, 4));
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) {
    console.log(result.error);
    process.exit(1);
  }
}

function copyFile(src, dst) {
  run("cp", [src, dst]);
}

function endsWith(str, suffix) {
  if (str.length < suffix.length) return false;
  return str.substr(str.length - suffix.length) === suffix;
}

function replaceAll(content, from, to) {
  for (;;) {
    const newContent = content.replace(from, to);
    if (content === newContent) return content;
    content = newContent;
  }
}

function ignoreExceptions(f) {
  try {
    f();
  } catch (e) {}
}

try {
  if (!fs.existsSync("src")) {
    run("mkdir", ["src"]);
  }

  const srcDir = "../../src/quicktype-typescript-input";
  for (const fn of fs.readdirSync(srcDir).filter(fn => endsWith(fn, ".ts"))) {
    const dstPath = path.join("src", fn);
    copyFile(path.join(srcDir, fn), dstPath);
    mapFile(dstPath, dstPath, content =>
      replaceAll(content, '} from "../quicktype-core', '} from "quicktype-core')
    );
  }
  copyFile(path.join(srcDir, "tsconfig.json"), "./");

  writePackage("file:../quicktype-core");
  run("npm", ["install"]);
  // writePackage("^0.0.6");
  // run("npm", ["publish"]);
} catch (e) {
  console.log(e);
  process.exit(1);
} finally {
  ignoreExceptions(() => fs.unlinkSync("package.json"));
  ignoreExceptions(() => fs.unlinkSync("tsconfig.json"));
  ignoreExceptions(() => run("rm", ["-rf", "src"]));
}

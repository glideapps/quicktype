#!/usr/bin/env ts-node -O {"target":"es6"}

import * as shell from "shelljs";
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

const OUTDIR = "dist";

function mapFile(
  source: string,
  destination: string,
  transform: (content: string) => string
) {
  const content = fs.readFileSync(source, "utf8");
  fs.writeFileSync(destination, transform(content));
}

function installPrereqs() {
  shell.exec("npm install --ignore-scripts");
}

function buildTypeScript() {
  shell.exec(`tsc --project src`);
}

function makeDistributedCLIExecutable() {
  const prefix = "#!/usr/bin/env node\n";
  const cli = path.join(OUTDIR, "quicktype.js");
  mapFile(cli, cli, content => {
    if (content.substr(0, prefix.length) === prefix) {
      return content;
    }
    return prefix + content;
  });
  shell.chmod("+x", cli);
}

function bundleDistributables() {
  shell.cp(["README.md", "package.json"], "dist");
}

function main() {
  const skipPrereqs = !!process.env.SKIP_INSTALL_PREREQUISITES;

  if (!skipPrereqs) {
    installPrereqs();
  }

  buildTypeScript();
  makeDistributedCLIExecutable();
  bundleDistributables();
}

main();

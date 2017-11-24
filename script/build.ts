#!/usr/bin/env ts-node

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
  shell.exec(`tsc --project src-ts`);
}

function moveTypeScriptBuildToDist() {
  const isDirectory = source => fs.lstatSync(source).isDirectory();

  const modules = fs
    .readdirSync(OUTDIR)
    .map(name => path.join(OUTDIR, name))
    .filter(isDirectory)
    .map(name => path.basename(name));

  const sources = shell
    .find("src-ts")
    .filter(f => f.endsWith(".d.ts") || f.endsWith(".js"));

  for (const source of sources) {
    const dest = source.replace("src-ts", OUTDIR);
    shell.mkdir("-p", path.dirname(dest));
    shell.mv(source, dest);
  }
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

function main() {
  const skipPrereqs = !!process.env.SKIP_INSTALL_PREREQUISITES;

  if (!skipPrereqs) {
    installPrereqs();
  }

  buildTypeScript();
  moveTypeScriptBuildToDist();
  makeDistributedCLIExecutable();
}

main();

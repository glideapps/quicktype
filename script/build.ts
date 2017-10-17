#!/usr/bin/env ts-node

import * as shell from "shelljs";
import * as fs from "fs";
import * as path from "path";
import * as _ from "lodash";

const OUTDIR = "dist";

function mapFile(
  source: string,
  destination: string,
  transform: (string) => string
) {
  const content = fs.readFileSync(source, "utf8");
  fs.writeFileSync(destination, transform(content));
}

function installPrereqs() {
  shell.exec("npm install --ignore-scripts");
  shell.exec("bower install --allow-root");
}

function buildPureScript() {
  shell.exec(
    `pulp build --build-path ${OUTDIR} -- --source-maps --stash --censor-warnings`
  );
}

function moveTypeScriptTypingsNextToPureScriptOutput() {
  const typeDefinitions = shell.find("src").filter(f => f.endsWith(".d.ts"));

  for (const typeDef of typeDefinitions) {
    // src/A/B.d.ts -> A.B
    const module = typeDef
      .replace("src/", "")
      .replace(".d.ts", "")
      .replace(/\//g, ".");
    mapFile(typeDef, `${OUTDIR}/${module}/index.d.ts`, content => {
      // Rewrite relative imports within typedefs
      //
      //   import * as Maybe from "./Data/Maybe";
      //
      //   becomes:
      //
      //   import * as Maybe from "../Data.Maybe";
      //
      // This is required as PureScript compiler outputs a flat module heirarchy
      return content.replace(/from \"\.+\/(.+)";/gm, (match, path) => {
        const module = path.replace(/\//g, ".");
        return `from "../${module}";`;
      });
    });
  }
}

function buildTypeScript() {
  shell.exec(`tsc --project src-ts`);
}

// Rewrite `require("Module")` as `require("./Module")` for PureScript modules
// required from compiled TypeScript
//
// TODO I hate this, but after two weeks trying to make TypeScript, PureScript,
// and JavaScript play nicely together, I'm saying "fuck it".
//
// Imports have to be absolute to compile, but relative to run. Seriously, fuck it.
function rewritePureScriptModuleRequiresInTypeScriptBuildOutputThenMoveTypeScriptBuildToDist() {
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

    mapFile(source, dest, content => {
      return content
        .replace(/require\(\"(.+)\"\);/gm, (original, module) => {
          if (_.includes(modules, module)) {
            return `require("./${module}")`;
          } else {
            return original;
          }
        })
        .replace(/from \"(.+)";/gm, (original, module) => {
          if (_.includes(modules, module)) {
            return `from "./${module}"`;
          } else {
            return original;
          }
        });
    });

    // We've moved the file, remove it to tidy up
    shell.rm(source);
  }
}

function makeDistributedCLIExecutable() {
  const cli = path.join(OUTDIR, "quicktype.js");
  mapFile(cli, cli, content => "#!/usr/bin/env node\n" + content);
  shell.chmod("+x", cli);
}

function main() {
  installPrereqs();
  buildPureScript();
  moveTypeScriptTypingsNextToPureScriptOutput();
  buildTypeScript();
  rewritePureScriptModuleRequiresInTypeScriptBuildOutputThenMoveTypeScriptBuildToDist();
  makeDistributedCLIExecutable();
}

main();

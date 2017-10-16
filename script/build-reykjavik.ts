#!/usr/bin/env ts-node

import * as shell from "shelljs";
import * as path from "path";
import * as fs from "fs";

function buildReykjavik() {
  const languages: string[] = shell
    .ls("src/Reykjavik/Language/*.ts")
    .filter(n => !n.endsWith(".d.ts"))
    .map(n => path.basename(n, ".ts"));

  shell.exec("tsc --project src/Reykjavik");

  // Create a PureScript FFI module for each Reykjavik language
  for (const language of languages) {
    const pursModule = fs.createWriteStream(
      `src/Reykjavik/Language/${language}.purs`
    );

    pursModule.write(`module Reykjavik.Language.${language} where\n\n`);
    pursModule.write("import Reykjavik.TargetLanguage\n\n");
    pursModule.write("foreign import targetLanguage :: TargetLanguage\n");
    pursModule.end();
  }

  // Create Reykjavik.Language.All
  const mainModule = fs.createWriteStream("src/Reykjavik/Language/All.purs");
  mainModule.write("module Reykjavik.Language.All where\n\n");

  mainModule.write("import Reykjavik.TargetLanguage\n");
  for (const language of languages) {
    mainModule.write(`import Reykjavik.Language.${language} as ${language}\n`);
  }

  mainModule.write("\ntargetLanguages :: Array TargetLanguage\n");
  mainModule.write("targetLanguages =\n");
  let firstLanguage = true;
  for (const language of languages) {
    mainModule.write(
      `\t${firstLanguage ? "[" : ","} ${language}.targetLanguage\n`
    );
    firstLanguage = false;
  }
  mainModule.write("\t]\n");

  mainModule.end();
}

buildReykjavik();

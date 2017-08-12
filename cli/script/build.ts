#!/usr/bin/env ts-node

import * as fs from "fs";
import * as process from "process";
import { execSync } from "child_process";

execSync("tsc quicktype.ts");
let source = fs.readFileSync("quicktype.js", "utf8");
let output = source.replace("ts-node", "node");
fs.writeFileSync("quicktype.js", output);
execSync("chmod +x quicktype.js");
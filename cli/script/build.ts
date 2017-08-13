#!/usr/bin/env ts-node

import * as fs from "fs";
import * as process from "process";
import { execSync } from "child_process";

execSync("tsc");
let source = fs.readFileSync("dist/quicktype.js", "utf8");

let output = source.replace(
    /^(.*)$/m,
    "#!/usr/bin/env node");

fs.writeFileSync("dist/quicktype.js", output);
execSync("chmod +x dist/quicktype.js");
#!/usr/bin/env ts-node

import * as fs from "fs";
import * as process from "process";
import { execSync } from "child_process";

execSync("tsc");
let source = fs.readFileSync("quicktype.js", "utf8");

let output = source.replace(
    /^(.*)$/m,
    "#!/usr/bin/env node");

fs.writeFileSync("quicktype.js", output);
execSync("chmod +x quicktype.js");
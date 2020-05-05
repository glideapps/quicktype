import fs from "fs";
import process from "process";
import * as TopLevel from "./toplevel.js";

const sample = process.argv[2];
const json = fs.readFileSync(sample);

console.log("READ", TopLevel);

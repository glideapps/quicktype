import * as TopLevel from "./TopLevel";

declare function require(path: string): any;
const fs = require("fs");
const process = require("process");

const sample = process.argv[2];
const json = fs.readFileSync(sample);

let value = TopLevel.Convert.toTopLevel(json);
let backToJson = TopLevel.Convert.topLevelToJson(value);

console.log(backToJson);

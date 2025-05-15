import * as TopLevel from "./TopLevel";

declare function require(path: string): any;
const fs = require("fs");
const process = require("process");

const sample = process.argv[2];
const json = fs.readFileSync(sample);

const value = TopLevel.Convert.toTopLevel(json);
const backToJson = TopLevel.Convert.topLevelToJson(value);

console.log(backToJson);

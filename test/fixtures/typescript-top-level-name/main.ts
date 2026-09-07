import * as Acme from "./TopLevel";

declare function require(path: string): any;
const fs = require("fs");
const process = require("process");

const sample = process.argv[2];
const json = fs.readFileSync(sample);

const value = Acme.Convert.toAcme(json);
const backToJson = Acme.Convert.acmeToJson(value);

console.log(backToJson);

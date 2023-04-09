import * as TopLevel from "./TopLevel";
import fs from "fs";
import process from "process";

const sample = process.argv[2];
const json = fs.readFileSync(sample);

let value = JSON.parse(json.toString());
let parsedValue = TopLevel.TopLevelSchema.parse(value);
let backToJson = JSON.stringify(parsedValue, null, 2);

console.log(backToJson);

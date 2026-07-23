import * as TopLevel from "./TopLevel";
import fs from "fs";
import process from "process";

const sample = process.argv[2];
const json = fs.readFileSync(sample);

const value = JSON.parse(json.toString());
let schema = TopLevel.TopLevelSchema;
if (!schema) {
    // Sometimes key is prefixed with funPrefixes (e.g. 2df80.json)
    Object.keys(TopLevel).some((key) => {
        if (key.endsWith("TopLevelSchema")) {
            schema = TopLevel[key];
            return true;
        }
    });
}

if (!schema) {
    throw new Error("No schema found");
}

const parsedValue = schema.parse(value);
console.log(JSON.stringify(parsedValue, null, 2));

import * as TopLevel from "./TopLevel";
import fs from "fs";
import process from "process";
import * as Schema from "effect/Schema";

const sample = process.argv[2];
const json = fs.readFileSync(sample);

const value = JSON.parse(json.toString());
let schema = TopLevel.TopLevel ?? TopLevel.TopLevelElement;
if (!schema) {
    // Sometimes key is prefixed with funPrefixes (e.g. 2df80.json)
    Object.keys(TopLevel).some((key) => {
        if (key.endsWith("TopLevel") || key.endsWith("TopLevelElement")) {
            schema = TopLevel[key];
            return true;
        }
    });
}

if (!schema) {
    throw new Error("No schema found");
}

const parsedValue = Schema.decodeUnknownSync(schema)(value);
const backToJson = JSON.stringify(parsedValue, null, 2);

console.log(backToJson);

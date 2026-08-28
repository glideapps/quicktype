import * as TopLevel from "./TopLevel";

declare function require(path: string): any;
const fs = require("fs");
const process = require("process");

const sample = process.argv[2];
const json = fs.readFileSync(sample);

const value = TopLevel.Convert.toTopLevel(json);
const backToJson = TopLevel.Convert.topLevelToJson(value);

if (sample.endsWith("property-order.1.json")) {
    const input = JSON.parse(json.toString());
    const output = JSON.parse(backToJson);
    const keys = (object: object) => JSON.stringify(Object.keys(object));
    if (
        keys(input) !== keys(output) ||
        keys(input.ordered) !== keys(output.ordered)
    ) {
        throw new Error("Generated property order does not match the schema");
    }
}

console.log(backToJson);

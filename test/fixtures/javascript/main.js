const TopLevel = require("./TopLevel");

const fs = require("fs");
const process = require("process");

const sample = process.argv[2];
const json = fs.readFileSync(sample);
const input = process.env.QUICKTYPE_RAW_TYPE === "any" ? JSON.parse(json) : json;

const value = TopLevel.toTopLevel(input);
const backToJson = TopLevel.topLevelToJson(value);

console.log(
    process.env.QUICKTYPE_RAW_TYPE === "any"
        ? JSON.stringify(backToJson)
        : backToJson,
);

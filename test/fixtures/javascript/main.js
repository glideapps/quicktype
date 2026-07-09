const TopLevel = require("./TopLevel");

const fs = require("fs");
const process = require("process");

const sample = process.argv[2];
const json = fs.readFileSync(sample);

const value = TopLevel.toTopLevel(json);
const backToJson = TopLevel.topLevelToJson(value);

console.log(backToJson);

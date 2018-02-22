const TopLevel = require("./TopLevel");

const fs = require("fs");
const process = require("process");

const sample = process.argv[2];
const json = fs.readFileSync(sample);

let value = TopLevel.toTopLevel(json);
let backToJson = TopLevel.topLevelToJson(value);

console.log(backToJson);

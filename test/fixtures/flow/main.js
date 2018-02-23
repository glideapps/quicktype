// @flow

const TopLevel = require("./TopLevel");

const fs = require("fs");

const sample = process.argv[2];
const json = fs.readFileSync(sample).toString();

let value = TopLevel.toTopLevel(json);
let backToJson = TopLevel.topLevelToJson(value);

console.log(backToJson);

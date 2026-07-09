// @flow

const TopLevel = require("./TopLevel");

const fs = require("fs");

const sample = process.argv[2];
const json = fs.readFileSync(sample).toString();

const value = TopLevel.toTopLevel(json);
const backToJson = TopLevel.topLevelToJson(value);

console.log(backToJson);

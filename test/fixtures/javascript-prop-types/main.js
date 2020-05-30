const fs = require("fs");
const process = require("process");
const { TopLevel } = require("./toplevel.js");
const checkPropTypes = require("check-prop-types");

const sample = process.argv[2];
const json = fs.readFileSync(sample);
const obj = JSON.parse(json);

const results = checkPropTypes({ obj: TopLevel }, { obj }, "prop", "MyComponent");

if (results) {
  console.log("Failure:", results);
} else {
  console.log("Success");
}

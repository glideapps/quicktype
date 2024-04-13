import { readFileSync } from "fs";
import { argv } from "process";
import { TopLevel } from "./toplevel.js";
import checkPropTypes from "check-prop-types";

const sample = argv[2];
const json = readFileSync(sample);
const obj = JSON.parse(json);

const results = checkPropTypes({ obj: TopLevel }, { obj }, "prop", "MyComponent");

if (results) {
    console.log("Failure:", results);
} else {
    console.log("Success");
}

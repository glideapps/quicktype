import { readFileSync } from "node:fs";
import { argv } from "node:process";
import PropTypes from "prop-types";
import { TopLevel } from "./toplevel.js";

const sample = argv[2];
const json = readFileSync(sample);
const obj = JSON.parse(json);

const errors = [];
const originalConsoleError = console.error;
console.error = (...args) => errors.push(args.join(" "));

let checkerWorks = false;
try {
    // With NODE_ENV=production, prop-types exports no-op shims, which would
    // make every sample "succeed". Prove the checker reports errors before
    // trusting its silence.
    PropTypes.resetWarningCache();
    PropTypes.checkPropTypes(
        { sentinel: PropTypes.string.isRequired },
        {},
        "prop",
        "SelfTest",
    );
    checkerWorks = errors.length > 0;
    errors.length = 0;

    PropTypes.resetWarningCache();
    PropTypes.checkPropTypes({ obj: TopLevel }, { obj }, "prop", "MyComponent");
} finally {
    console.error = originalConsoleError;
}

if (!checkerWorks) {
    console.log(
        "Failure: prop-types checks are disabled (NODE_ENV=production?)",
    );
} else if (errors.length > 0) {
    console.log("Failure:", errors.join("\n"));
} else {
    console.log("Success");
}

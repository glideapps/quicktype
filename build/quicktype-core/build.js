"use strict";

const { buildCore, publishCore, getOptions } = require("../build-utils");

const options = getOptions();

buildCore(__dirname);
if (options.publish) {
    publishCore(__dirname);
}

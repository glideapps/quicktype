"use strict";

var parse = require('json-to-ast');

exports._parse = function (result) {
    return function (s) {
        try {
            var ast = parse(s, { verbose: false });
            return result.success(ast);
        } catch (e) {
            return result.fail(e.toString());
        }
    };
};

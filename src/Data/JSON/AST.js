"use strict";

var parse = require('json-to-ast');

exports._parse = function (result) {
    return function (s) {
        try {
            // https://github.com/vtrushin/json-to-ast/issues/15
            var ast = parse(s, { verbose: true });
            return result.success(ast);
        } catch (e) {
            return result.fail(e.toString());
        }
    };
};

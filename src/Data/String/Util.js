"use strict";

var pluralize = require('../../bower_components/pluralize');

exports._singular = pluralize.singular;
exports._plural = pluralize.plural;

exports.isInt = function (s) {
    // This returns false positive for "10.0"
    // return +s === parseInt(s);

    // This isn't ideal
    return /^\d+$/.test(s);
};
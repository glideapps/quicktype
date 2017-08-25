"use strict";

var pluralize = require('../../bower_components/pluralize');

exports._singular = pluralize.singular;
exports._plural = pluralize.plural;

exports.isInt = function (s) {
    return +s === parseInt(s);
};
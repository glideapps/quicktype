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

exports.stringConcatMap = function stringConcatMap(mapper) {
    var charStringMap = [];
    var charNoEscapeMap = [];

    for (var i = 0; i < 128; i++) {
        var noEscape = 0;
        var input = String.fromCharCode(i);
        var result = mapper(input);
        if (result === input) {
            noEscape = 1;
        }
        charStringMap.push(result);
        charNoEscapeMap.push(noEscape);
    }
    
    return function stringConcatMap_inner(s) {
        var cs = null;
        var start = 0;
        var i = 0;
        while (i < s.length) {
            var cc = s.charCodeAt(i);
            if (!charNoEscapeMap[cc]) {
                if (cs == null)
                    cs = [];
                cs.push(s.substring(start, i));
        
                var str = charStringMap[cc];
                if (str === undefined) {
                    cs.push(mapper(s.charAt(i)));
                } else {
                    cs.push(str);
                }
        
                start = i + 1;
            }
            i++;
        }
    
        if (cs === null)
            return s;
    
        cs.push(s.substring(start, i));
    
        return cs.join("");    
    };
};

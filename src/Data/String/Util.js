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

var charStringMap = [];
var charNoEscapeMap = new Int8Array(128);

for (var i = 0; i < 128; i++) {
    var str = undefined;
    var noEscape = 0;
    if (i == "\\".charCodeAt(0) || i == "\"".charCodeAt(0)) {
        str = "\\" + String.fromCharCode(i);
    } else if (i == "\n".charCodeAt(0)) {
        str = "\\n";
    } else if (i == "\t".charCodeAt(0)) {
        str = "\\t";
    } else if (i >= 32) {
        str = true;
        noEscape = 1;
    }
    charStringMap.push(str);
    charNoEscapeMap[i] = noEscape;
}

exports.internalStringEscape = function internalStringEscape(mapper) {
    return function internalStringEscape_inner(s) {
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
    }
};

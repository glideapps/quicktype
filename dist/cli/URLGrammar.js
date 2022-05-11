"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const quicktype_core_1 = require("../quicktype-core");
function expand(json) {
    if (typeof json === "string") {
        return [json];
    }
    if (Array.isArray(json)) {
        let result = [""];
        for (const j of json) {
            const expanded = expand(j);
            const appended = [];
            for (const a of result) {
                for (const b of expanded) {
                    appended.push(a + b);
                }
            }
            result = appended;
        }
        return result;
    }
    if (Object.prototype.hasOwnProperty.call(json, "oneOf")) {
        const options = quicktype_core_1.checkArray(json.oneOf);
        const result = [];
        for (const j of options) {
            for (const x of expand(j)) {
                result.push(x);
            }
        }
        return result;
    }
    return quicktype_core_1.panic(`Value is not a valid URL grammar: ${json}`);
}
function urlsFromURLGrammar(json) {
    const topLevelMap = quicktype_core_1.checkStringMap(json);
    const results = {};
    for (const name of Object.getOwnPropertyNames(topLevelMap)) {
        results[name] = expand(topLevelMap[name]);
    }
    return results;
}
exports.urlsFromURLGrammar = urlsFromURLGrammar;

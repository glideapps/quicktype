"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferTransformedStringTypeKindForString = exports.stringTypesTypeAttributeKind = exports.StringTypes = void 0;
const collection_utils_1 = require("collection-utils");
const TypeAttributes_1 = require("./TypeAttributes");
const Support_1 = require("../support/Support");
const TypeBuilder_1 = require("../TypeBuilder");
class StringTypes {
    static fromCase(s, count) {
        const caseMap = {};
        caseMap[s] = count;
        return new StringTypes(new Map([[s, count]]), new Set());
    }
    static fromCases(cases) {
        const caseMap = {};
        for (const s of cases) {
            caseMap[s] = 1;
        }
        return new StringTypes(new Map(cases.map(s => [s, 1])), new Set());
    }
    // undefined means no restrictions
    constructor(cases, transformations) {
        this.cases = cases;
        this.transformations = transformations;
        if (cases === undefined) {
            (0, Support_1.assert)(transformations.size === 0, "We can't have an unrestricted string that also allows transformations");
        }
    }
    get isRestricted() {
        return this.cases !== undefined;
    }
    union(othersArray, startIndex) {
        if (this.cases === undefined)
            return this;
        const cases = new Map(this.cases);
        const transformations = new Set(this.transformations);
        for (let i = startIndex; i < othersArray.length; i++) {
            const other = othersArray[i];
            if (other.cases === undefined)
                return other;
            (0, collection_utils_1.mapMergeWithInto)(cases, (x, y) => x + y, other.cases);
            (0, collection_utils_1.setUnionInto)(transformations, other.transformations);
        }
        return new StringTypes(cases, transformations);
    }
    intersect(othersArray, startIndex) {
        let cases = this.cases;
        let transformations = this.transformations;
        for (let i = startIndex; i < othersArray.length; i++) {
            const other = othersArray[i];
            if (cases === undefined) {
                cases = (0, collection_utils_1.definedMap)(other.cases, m => new Map(m));
            }
            else if (other.cases !== undefined) {
                const thisCases = cases;
                const otherCases = other.cases;
                cases = (0, collection_utils_1.mapMap)((0, collection_utils_1.setIntersect)(thisCases.keys(), new Set(otherCases.keys())).entries(), k => Math.min((0, Support_1.defined)(thisCases.get(k)), (0, Support_1.defined)(otherCases.get(k))));
            }
            transformations = (0, collection_utils_1.setIntersect)(transformations, other.transformations);
        }
        return new StringTypes(cases, transformations);
    }
    applyStringTypeMapping(mapping) {
        if (!this.isRestricted)
            return this;
        const kinds = new Set();
        for (const kind of this.transformations) {
            const mapped = (0, TypeBuilder_1.stringTypeMappingGet)(mapping, kind);
            if (mapped === "string")
                return StringTypes.unrestricted;
            kinds.add(mapped);
        }
        return new StringTypes(this.cases, new Set(kinds));
    }
    equals(other) {
        if (!(other instanceof StringTypes))
            return false;
        return (0, collection_utils_1.areEqual)(this.cases, other.cases) && (0, collection_utils_1.areEqual)(this.transformations, other.transformations);
    }
    hashCode() {
        let h = (0, collection_utils_1.hashCodeOf)(this.cases);
        h = (0, collection_utils_1.addHashCode)(h, (0, collection_utils_1.hashCodeOf)(this.transformations));
        return h;
    }
    toString() {
        const parts = [];
        const enumCases = this.cases;
        if (enumCases === undefined) {
            parts.push("unrestricted");
        }
        else {
            const firstKey = (0, collection_utils_1.iterableFirst)(enumCases.keys());
            if (firstKey === undefined) {
                parts.push("enum with no cases");
            }
            else {
                parts.push(`${enumCases.size.toString()} enums: ${firstKey} (${enumCases.get(firstKey)}), ...`);
            }
        }
        return parts.concat(Array.from(this.transformations)).join(",");
    }
}
exports.StringTypes = StringTypes;
StringTypes.unrestricted = new StringTypes(undefined, new Set());
class StringTypesTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("stringTypes");
    }
    get inIdentity() {
        return true;
    }
    requiresUniqueIdentity(st) {
        return st.cases !== undefined && st.cases.size > 0;
    }
    combine(arr) {
        (0, Support_1.assert)(arr.length > 0);
        return arr[0].union(arr, 1);
    }
    intersect(arr) {
        (0, Support_1.assert)(arr.length > 0);
        return arr[0].intersect(arr, 1);
    }
    makeInferred(_) {
        return undefined;
    }
    stringify(st) {
        return st.toString();
    }
}
exports.stringTypesTypeAttributeKind = new StringTypesTypeAttributeKind();
const INTEGER_STRING = /^(0|-?[1-9]\d*)$/;
// We're restricting numbers to what's representable as 32 bit
// signed integers, to be on the safe side of most languages.
const MIN_INTEGER_STRING = 1 << 31;
const MAX_INTEGER_STRING = -(MIN_INTEGER_STRING + 1);
function isIntegerString(s) {
    if (s.match(INTEGER_STRING) === null) {
        return false;
    }
    const i = parseInt(s, 10);
    return i >= MIN_INTEGER_STRING && i <= MAX_INTEGER_STRING;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function isUUID(s) {
    return s.match(UUID) !== null;
}
// FIXME: This is obviously not a complete URI regex.  The exclusion of
// `{}` is a hack to make `github-events.json` work, which contains URLs
// with those characters which ajv refuses to accept as `uri`.
const URI = /^(https?|ftp):\/\/[^{}]+$/;
function isURI(s) {
    return s.match(URI) !== null;
}
/**
 * JSON inference calls this function to figure out whether a given string is to be
 * transformed into a higher level type.  Must return undefined if not, otherwise the
 * type kind of the transformed string type.
 *
 * @param s The string for which to determine the transformed string type kind.
 */
function inferTransformedStringTypeKindForString(s, recognizer) {
    if (s.length === 0 || "0123456789-abcdefth".indexOf(s[0]) < 0)
        return undefined;
    if (recognizer.isDate(s)) {
        return "date";
    }
    else if (recognizer.isTime(s)) {
        return "time";
    }
    else if (recognizer.isDateTime(s)) {
        return "date-time";
    }
    else if (isIntegerString(s)) {
        return "integer-string";
    }
    else if (s === "false" || s === "true") {
        return "bool-string";
    }
    else if (isUUID(s)) {
        return "uuid";
    }
    else if (isURI(s)) {
        return "uri";
    }
    return undefined;
}
exports.inferTransformedStringTypeKindForString = inferTransformedStringTypeKindForString;

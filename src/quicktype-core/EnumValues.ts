"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("./support/Support");

class EnumValuesTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("enumValues");
    }
    makeInferred(_) {
        return undefined;
    }
}
exports.enumValuesTypeAttributeKind = new EnumValuesTypeAttributeKind();

// Returns [name, isFixed].
function getFromEntry(entry, language) {
    if (typeof entry === "string")
        return [entry, false];
    const maybeForLanguage = entry.get(language);
    if (maybeForLanguage !== undefined)
        return [maybeForLanguage, true];
    const maybeWildcard = entry.get("*");
    if (maybeWildcard !== undefined)
        return [maybeWildcard, false];
    return undefined;
}

function lookupKey(enumvalues, key, language) {
    const entry = enumvalues.get(key);
    if (entry === undefined)
        return undefined;
    return getFromEntry(entry, language);
}

function isEnumValuesEntry(x) {
    if (typeof x === "string") {
        return true;
    }
    return Support_1.isStringMap(x, (v) => typeof v === "string");
}

function makeEnumValuesEntry(ae) {
    if (typeof ae === "string")
        return ae;
    return collection_utils_1.mapFromObject(ae);
}

function makeEnumValues(x) {
    // FIXME: Do proper error reporting
    const stringMap = Support_1.checkStringMap(x, isEnumValuesEntry);
    return collection_utils_1.mapMap(collection_utils_1.mapFromObject(stringMap), makeEnumValuesEntry);
}
function enumValuesAttributeProducer(schema, canonicalRef, _types) {
    if (typeof schema !== "object")
        return undefined;
    const maybeEnumValues = schema["qt-enum-values"];
    if (maybeEnumValues === undefined)
        return undefined;

    return { forType: exports.enumValuesTypeAttributeKind.makeAttributes(makeEnumValues(maybeEnumValues)) };
}

exports.enumValuesAttributeProducer = enumValuesAttributeProducer;
function getEnumValue(names, original) {
    const maybeName = names.get(original);
    return maybeName;
}
exports.getEnumValue = getEnumValue;

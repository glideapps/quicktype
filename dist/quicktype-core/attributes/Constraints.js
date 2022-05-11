"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const TypeAttributes_1 = require("./TypeAttributes");
const Support_1 = require("../support/Support");
const Messages_1 = require("../Messages");
function checkMinMaxConstraint(minmax) {
    const [min, max] = minmax;
    if (typeof min === "number" && typeof max === "number" && min > max) {
        return Messages_1.messageError("MiscInvalidMinMaxConstraint", { min, max });
    }
    if (min === undefined && max === undefined) {
        return undefined;
    }
    return minmax;
}
class MinMaxConstraintTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor(name, _typeKinds, _minSchemaProperty, _maxSchemaProperty) {
        super(name);
        this._typeKinds = _typeKinds;
        this._minSchemaProperty = _minSchemaProperty;
        this._maxSchemaProperty = _maxSchemaProperty;
    }
    get inIdentity() {
        return true;
    }
    combine(arr) {
        Support_1.assert(arr.length > 0);
        let [min, max] = arr[0];
        for (let i = 1; i < arr.length; i++) {
            const [otherMin, otherMax] = arr[i];
            if (typeof min === "number" && typeof otherMin === "number") {
                min = Math.min(min, otherMin);
            }
            else {
                min = undefined;
            }
            if (typeof max === "number" && typeof otherMax === "number") {
                max = Math.max(max, otherMax);
            }
            else {
                max = undefined;
            }
        }
        return checkMinMaxConstraint([min, max]);
    }
    intersect(arr) {
        Support_1.assert(arr.length > 0);
        let [min, max] = arr[0];
        for (let i = 1; i < arr.length; i++) {
            const [otherMin, otherMax] = arr[i];
            if (typeof min === "number" && typeof otherMin === "number") {
                min = Math.max(min, otherMin);
            }
            else if (min === undefined) {
                min = otherMin;
            }
            if (typeof max === "number" && typeof otherMax === "number") {
                max = Math.min(max, otherMax);
            }
            else if (max === undefined) {
                max = otherMax;
            }
        }
        return checkMinMaxConstraint([min, max]);
    }
    makeInferred(_) {
        return undefined;
    }
    addToSchema(schema, t, attr) {
        if (this._typeKinds.has(t.kind))
            return;
        const [min, max] = attr;
        if (min !== undefined) {
            schema[this._minSchemaProperty] = min;
        }
        if (max !== undefined) {
            schema[this._maxSchemaProperty] = max;
        }
    }
    stringify([min, max]) {
        return `${min}-${max}`;
    }
}
exports.MinMaxConstraintTypeAttributeKind = MinMaxConstraintTypeAttributeKind;
exports.minMaxTypeAttributeKind = new MinMaxConstraintTypeAttributeKind("minMax", new Set(["integer", "double"]), "minimum", "maximum");
exports.minMaxLengthTypeAttributeKind = new MinMaxConstraintTypeAttributeKind("minMaxLength", new Set(["string"]), "minLength", "maxLength");
function producer(schema, minProperty, maxProperty) {
    if (!(typeof schema === "object"))
        return undefined;
    let min = undefined;
    let max = undefined;
    if (typeof schema[minProperty] === "number") {
        min = schema[minProperty];
    }
    if (typeof schema[maxProperty] === "number") {
        max = schema[maxProperty];
    }
    if (min === undefined && max === undefined)
        return undefined;
    return [min, max];
}
function minMaxAttributeProducer(schema, _ref, types) {
    if (!types.has("number") && !types.has("integer"))
        return undefined;
    const maybeMinMax = producer(schema, "minimum", "maximum");
    if (maybeMinMax === undefined)
        return undefined;
    return { forNumber: exports.minMaxTypeAttributeKind.makeAttributes(maybeMinMax) };
}
exports.minMaxAttributeProducer = minMaxAttributeProducer;
function minMaxLengthAttributeProducer(schema, _ref, types) {
    if (!types.has("string"))
        return undefined;
    const maybeMinMaxLength = producer(schema, "minLength", "maxLength");
    if (maybeMinMaxLength === undefined)
        return undefined;
    return { forString: exports.minMaxLengthTypeAttributeKind.makeAttributes(maybeMinMaxLength) };
}
exports.minMaxLengthAttributeProducer = minMaxLengthAttributeProducer;
function minMaxValueForType(t) {
    return exports.minMaxTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
exports.minMaxValueForType = minMaxValueForType;
function minMaxLengthForType(t) {
    return exports.minMaxLengthTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
exports.minMaxLengthForType = minMaxLengthForType;
class PatternTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("pattern");
    }
    get inIdentity() {
        return true;
    }
    combine(arr) {
        Support_1.assert(arr.length > 0);
        return arr.map(p => `(${p})`).join("|");
    }
    intersect(_arr) {
        /** FIXME!!! what is the intersection of regexps? */
        return undefined;
    }
    makeInferred(_) {
        return undefined;
    }
    addToSchema(schema, t, attr) {
        if (t.kind !== "string")
            return;
        schema.pattern = attr;
    }
}
exports.PatternTypeAttributeKind = PatternTypeAttributeKind;
exports.patternTypeAttributeKind = new PatternTypeAttributeKind();
function patternAttributeProducer(schema, _ref, types) {
    if (!(typeof schema === "object"))
        return undefined;
    if (!types.has("string"))
        return undefined;
    const patt = schema.pattern;
    if (typeof patt !== "string")
        return undefined;
    return { forString: exports.patternTypeAttributeKind.makeAttributes(patt) };
}
exports.patternAttributeProducer = patternAttributeProducer;
function patternForType(t) {
    return exports.patternTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
exports.patternForType = patternForType;

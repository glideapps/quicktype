"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("../support/Support");
class TypeAttributeKind {
    constructor(name) {
        this.name = name;
    }
    appliesToTypeKind(kind) {
        return kind !== "any";
    }
    combine(_attrs) {
        return Support_1.panic(`Cannot combine type attribute ${this.name}`);
    }
    intersect(attrs) {
        return this.combine(attrs);
    }
    makeInferred(_) {
        return Support_1.panic(`Cannot make type attribute ${this.name} inferred`);
    }
    increaseDistance(attrs) {
        return attrs;
    }
    addToSchema(_schema, _t, _attrs) {
        return;
    }
    children(_) {
        return new Set();
    }
    stringify(_) {
        return undefined;
    }
    get inIdentity() {
        return false;
    }
    requiresUniqueIdentity(_) {
        return false;
    }
    reconstitute(_builder, a) {
        return a;
    }
    makeAttributes(value) {
        const kvps = [[this, value]];
        return new Map(kvps);
    }
    tryGetInAttributes(a) {
        return a.get(this);
    }
    setInAttributes(a, value) {
        // FIXME: This is potentially super slow
        return new Map(a).set(this, value);
    }
    modifyInAttributes(a, modify) {
        const modified = modify(this.tryGetInAttributes(a));
        if (modified === undefined) {
            // FIXME: This is potentially super slow
            const result = new Map(a);
            result.delete(this);
            return result;
        }
        return this.setInAttributes(a, modified);
    }
    setDefaultInAttributes(a, makeDefault) {
        if (this.tryGetInAttributes(a) !== undefined)
            return a;
        return this.modifyInAttributes(a, makeDefault);
    }
    removeInAttributes(a) {
        return collection_utils_1.mapFilter(a, (_, k) => k !== this);
    }
    equals(other) {
        if (!(other instanceof TypeAttributeKind)) {
            return false;
        }
        return this.name === other.name;
    }
    hashCode() {
        return collection_utils_1.hashString(this.name);
    }
}
exports.TypeAttributeKind = TypeAttributeKind;
exports.emptyTypeAttributes = new Map();
function combineTypeAttributes(combinationKind, firstOrArray, second) {
    const union = combinationKind === "union";
    let attributeArray;
    if (Array.isArray(firstOrArray)) {
        attributeArray = firstOrArray;
    }
    else {
        if (second === undefined) {
            return Support_1.panic("Must have on array or two attributes");
        }
        attributeArray = [firstOrArray, second];
    }
    const attributesByKind = collection_utils_1.mapTranspose(attributeArray);
    function combine(attrs, kind) {
        Support_1.assert(attrs.length > 0, "Cannot combine zero type attributes");
        if (attrs.length === 1)
            return attrs[0];
        if (union) {
            return kind.combine(attrs);
        }
        else {
            return kind.intersect(attrs);
        }
    }
    return collection_utils_1.mapFilterMap(attributesByKind, combine);
}
exports.combineTypeAttributes = combineTypeAttributes;
function makeTypeAttributesInferred(attr) {
    return collection_utils_1.mapFilterMap(attr, (value, kind) => kind.makeInferred(value));
}
exports.makeTypeAttributesInferred = makeTypeAttributesInferred;
function increaseTypeAttributesDistance(attr) {
    return collection_utils_1.mapFilterMap(attr, (value, kind) => kind.increaseDistance(value));
}
exports.increaseTypeAttributesDistance = increaseTypeAttributesDistance;

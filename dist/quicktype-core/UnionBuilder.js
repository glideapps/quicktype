"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Type_1 = require("./Type");
const TypeUtils_1 = require("./TypeUtils");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const Support_1 = require("./support/Support");
const StringTypes_1 = require("./attributes/StringTypes");
function addAttributes(accumulatorAttributes, newAttributes) {
    if (accumulatorAttributes === undefined)
        return newAttributes;
    return TypeAttributes_1.combineTypeAttributes("union", accumulatorAttributes, newAttributes);
}
function setAttributes(attributeMap, kind, newAttributes) {
    attributeMap.set(kind, addAttributes(attributeMap.get(kind), newAttributes));
}
function addAttributesToBuilder(builder, kind, newAttributes) {
    let arr = builder.get(kind);
    if (arr === undefined) {
        arr = [];
        builder.set(kind, arr);
    }
    arr.push(newAttributes);
}
function buildTypeAttributeMap(builder) {
    return collection_utils_1.mapMap(builder, arr => TypeAttributes_1.combineTypeAttributes("union", arr));
}
function moveAttributes(map, fromKind, toKind) {
    const fromAttributes = Support_1.defined(map.get(fromKind));
    map.delete(fromKind);
    setAttributes(map, toKind, fromAttributes);
}
class UnionAccumulator {
    constructor(_conflateNumbers) {
        this._conflateNumbers = _conflateNumbers;
        this._nonStringTypeAttributes = new Map();
        this._stringTypeAttributes = new Map();
        this.arrayData = [];
        this.objectData = [];
        this._enumCases = new Set();
        this._lostTypeAttributes = false;
    }
    have(kind) {
        return (this._nonStringTypeAttributes.has(kind) || this._stringTypeAttributes.has(kind));
    }
    addNone(_attributes) {
        // FIXME: Add them to all members?  Or add them to the union, which means we'd have
        // to change getMemberKinds() to also return the attributes for the union itself,
        // or add a new method that does that.
        this._lostTypeAttributes = true;
    }
    addAny(attributes) {
        addAttributesToBuilder(this._nonStringTypeAttributes, "any", attributes);
        this._lostTypeAttributes = true;
    }
    addPrimitive(kind, attributes) {
        Support_1.assert(kind !== "any", "any must be added with addAny");
        addAttributesToBuilder(this._nonStringTypeAttributes, kind, attributes);
    }
    addFullStringType(attributes, stringTypes) {
        let stringTypesAttributes = undefined;
        if (stringTypes === undefined) {
            stringTypes = StringTypes_1.stringTypesTypeAttributeKind.tryGetInAttributes(attributes);
        }
        else {
            stringTypesAttributes = StringTypes_1.stringTypesTypeAttributeKind.makeAttributes(stringTypes);
        }
        if (stringTypes === undefined) {
            stringTypes = StringTypes_1.StringTypes.unrestricted;
            stringTypesAttributes = StringTypes_1.stringTypesTypeAttributeKind.makeAttributes(stringTypes);
        }
        const maybeEnumAttributes = this._nonStringTypeAttributes.get("enum");
        if (stringTypes.isRestricted) {
            Support_1.assert(maybeEnumAttributes === undefined, "We can't add both an enum as well as a restricted string type to a union builder");
        }
        addAttributesToBuilder(this._stringTypeAttributes, "string", attributes);
        if (stringTypesAttributes !== undefined) {
            addAttributesToBuilder(this._stringTypeAttributes, "string", stringTypesAttributes);
        }
    }
    addStringType(kind, attributes, stringTypes) {
        if (kind === "string") {
            this.addFullStringType(attributes, stringTypes);
            return;
        }
        addAttributesToBuilder(this._stringTypeAttributes, kind, attributes);
        if (stringTypes !== undefined) {
            addAttributesToBuilder(this._stringTypeAttributes, kind, StringTypes_1.stringTypesTypeAttributeKind.makeAttributes(stringTypes));
        }
    }
    addArray(t, attributes) {
        this.arrayData.push(t);
        addAttributesToBuilder(this._nonStringTypeAttributes, "array", attributes);
    }
    addObject(t, attributes) {
        this.objectData.push(t);
        addAttributesToBuilder(this._nonStringTypeAttributes, "object", attributes);
    }
    addEnum(cases, attributes) {
        const maybeStringAttributes = this._stringTypeAttributes.get("string");
        if (maybeStringAttributes !== undefined) {
            addAttributesToBuilder(this._stringTypeAttributes, "string", attributes);
            return;
        }
        addAttributesToBuilder(this._nonStringTypeAttributes, "enum", attributes);
        collection_utils_1.setUnionInto(this._enumCases, cases);
    }
    addStringCases(cases, attributes) {
        this.addFullStringType(attributes, StringTypes_1.StringTypes.fromCases(cases));
    }
    addStringCase(s, count, attributes) {
        this.addFullStringType(attributes, StringTypes_1.StringTypes.fromCase(s, count));
    }
    get enumCases() {
        return this._enumCases;
    }
    getMemberKinds() {
        Support_1.assert(!(this.have("enum") && this.have("string")), "We can't have both strings and enums in the same union");
        let merged = collection_utils_1.mapMerge(buildTypeAttributeMap(this._nonStringTypeAttributes), buildTypeAttributeMap(this._stringTypeAttributes));
        if (merged.size === 0) {
            return new Map([["none", TypeAttributes_1.emptyTypeAttributes]]);
        }
        if (this._nonStringTypeAttributes.has("any")) {
            Support_1.assert(this._lostTypeAttributes, "This had to be set when we added 'any'");
            const allAttributes = TypeAttributes_1.combineTypeAttributes("union", Array.from(merged.values()));
            return new Map([["any", allAttributes]]);
        }
        if (this._conflateNumbers && this.have("integer") && this.have("double")) {
            moveAttributes(merged, "integer", "double");
        }
        if (this.have("map")) {
            moveAttributes(merged, "map", "class");
        }
        return merged;
    }
    get lostTypeAttributes() {
        return this._lostTypeAttributes;
    }
}
exports.UnionAccumulator = UnionAccumulator;
class FauxUnion {
    getAttributes() {
        return TypeAttributes_1.emptyTypeAttributes;
    }
}
function attributesForTypes(types) {
    // These two maps are the reverse of each other.  unionsForType is all the unions
    // that are ancestors of that type, when going from one of the given types, only
    // following unions.
    const unionsForType = new Map();
    const typesForUnion = new Map();
    // All the unions we've seen, starting from types, stopping when we hit non-unions.
    const unions = new Set();
    // All the unions that are equivalent to the single root type.  If more than one type
    // is given, this will be empty.
    let unionsEquivalentToRoot = new Set();
    function traverse(t, path, isEquivalentToRoot) {
        if (t instanceof Type_1.UnionType) {
            unions.add(t);
            if (isEquivalentToRoot) {
                unionsEquivalentToRoot = unionsEquivalentToRoot.add(t);
            }
            isEquivalentToRoot = isEquivalentToRoot && t.members.size === 1;
            path.push(t);
            for (const m of t.members) {
                traverse(m, path, isEquivalentToRoot);
            }
            path.pop();
        }
        else {
            collection_utils_1.mapUpdateInto(unionsForType, t, s => (s === undefined ? new Set(path) : collection_utils_1.setUnionInto(s, path)));
            for (const u of path) {
                collection_utils_1.mapUpdateInto(typesForUnion, u, s => (s === undefined ? new Set([t]) : s.add(t)));
            }
        }
    }
    const rootPath = [new FauxUnion()];
    const typesArray = Array.from(types);
    for (const t of typesArray) {
        traverse(t, rootPath, typesArray.length === 1);
    }
    const resultAttributes = collection_utils_1.mapMap(unionsForType, (unionForType, t) => {
        const singleAncestors = Array.from(unionForType).filter(u => Support_1.defined(typesForUnion.get(u)).size === 1);
        Support_1.assert(singleAncestors.every(u => Support_1.defined(typesForUnion.get(u)).has(t)), "We messed up bookkeeping");
        const inheritedAttributes = singleAncestors.map(u => u.getAttributes());
        return TypeAttributes_1.combineTypeAttributes("union", [t.getAttributes()].concat(inheritedAttributes));
    });
    const unionAttributes = Array.from(unions).map(u => {
        const t = typesForUnion.get(u);
        if (t !== undefined && t.size === 1) {
            return TypeAttributes_1.emptyTypeAttributes;
        }
        const attributes = u.getAttributes();
        if (unionsEquivalentToRoot.has(u)) {
            return attributes;
        }
        return TypeAttributes_1.makeTypeAttributesInferred(attributes);
    });
    return [resultAttributes, TypeAttributes_1.combineTypeAttributes("union", unionAttributes)];
}
// FIXME: Move this to UnifyClasses.ts?
class TypeRefUnionAccumulator extends UnionAccumulator {
    // There is a method analogous to this in the IntersectionAccumulator.  It might
    // make sense to find a common interface.
    addType(t, attributes) {
        TypeUtils_1.matchTypeExhaustive(t, _noneType => this.addNone(attributes), _anyType => this.addAny(attributes), _nullType => this.addPrimitive("null", attributes), _boolType => this.addPrimitive("bool", attributes), _integerType => this.addPrimitive("integer", attributes), _doubleType => this.addPrimitive("double", attributes), _stringType => this.addStringType("string", attributes), arrayType => this.addArray(arrayType.items.typeRef, attributes), classType => this.addObject(classType.typeRef, attributes), mapType => this.addObject(mapType.typeRef, attributes), objectType => this.addObject(objectType.typeRef, attributes), 
        // FIXME: We're not carrying counts, so this is not correct if we do enum
        // inference.  JSON Schema input uses this case, however, without enum
        // inference, which is fine, but still a bit ugly.
        enumType => this.addEnum(enumType.cases, attributes), _unionType => {
            return Support_1.panic("The unions should have been eliminated in attributesForTypesInUnion");
        }, transformedStringType => this.addStringType(transformedStringType.kind, attributes));
    }
    addTypes(types) {
        const [attributesMap, unionAttributes] = attributesForTypes(types);
        for (const [t, attributes] of attributesMap) {
            this.addType(t, attributes);
        }
        return unionAttributes;
    }
}
exports.TypeRefUnionAccumulator = TypeRefUnionAccumulator;
class UnionBuilder {
    constructor(typeBuilder) {
        this.typeBuilder = typeBuilder;
    }
    makeTypeOfKind(typeProvider, kind, typeAttributes, forwardingRef) {
        switch (kind) {
            case "string":
                return this.typeBuilder.getStringType(typeAttributes, undefined, forwardingRef);
            case "enum":
                return this.typeBuilder.getEnumType(typeAttributes, typeProvider.enumCases, forwardingRef);
            case "object":
                return this.makeObject(typeProvider.objectData, typeAttributes, forwardingRef);
            case "array":
                return this.makeArray(typeProvider.arrayData, typeAttributes, forwardingRef);
            default:
                if (Type_1.isPrimitiveTypeKind(kind)) {
                    return this.typeBuilder.getPrimitiveType(kind, typeAttributes, forwardingRef);
                }
                if (kind === "union" || kind === "class" || kind === "map" || kind === "intersection") {
                    return Support_1.panic(`getMemberKinds() shouldn't return ${kind}`);
                }
                return Support_1.assertNever(kind);
        }
    }
    buildUnion(typeProvider, unique, typeAttributes, forwardingRef) {
        const kinds = typeProvider.getMemberKinds();
        if (typeProvider.lostTypeAttributes) {
            this.typeBuilder.setLostTypeAttributes();
        }
        // FIXME: We don't reconstitute type attributes here, so it's possible that
        // we get type refs for the wrong graphs if the transformation making rewrite
        // makes unions that have to be unified here.  That's a bug anyway, at least
        // right now, it's just a very bad way of surfacing that error.
        if (kinds.size === 1) {
            const [[kind, memberAttributes]] = Array.from(kinds);
            const allAttributes = TypeAttributes_1.combineTypeAttributes("union", typeAttributes, TypeAttributes_1.increaseTypeAttributesDistance(memberAttributes));
            const t = this.makeTypeOfKind(typeProvider, kind, allAttributes, forwardingRef);
            return t;
        }
        const union = unique
            ? this.typeBuilder.getUniqueUnionType(typeAttributes, undefined, forwardingRef)
            : undefined;
        const types = [];
        for (const [kind, memberAttributes] of kinds) {
            types.push(this.makeTypeOfKind(typeProvider, kind, memberAttributes, undefined));
        }
        const typesSet = new Set(types);
        if (union !== undefined) {
            this.typeBuilder.setSetOperationMembers(union, typesSet);
            return union;
        }
        else {
            return this.typeBuilder.getUnionType(typeAttributes, typesSet, forwardingRef);
        }
    }
}
exports.UnionBuilder = UnionBuilder;

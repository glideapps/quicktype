"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("./support/Support");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const Type_1 = require("./Type");
const StringTypes_1 = require("./attributes/StringTypes");
function assertIsObject(t) {
    if (t instanceof Type_1.ObjectType) {
        return t;
    }
    return Support_1.panic("Supposed object type is not an object type");
}
exports.assertIsObject = assertIsObject;
function assertIsClass(t) {
    if (!(t instanceof Type_1.ClassType)) {
        return Support_1.panic("Supposed class type is not a class type");
    }
    return t;
}
exports.assertIsClass = assertIsClass;
function setOperationMembersRecursively(oneOrMany, combinationKind) {
    const setOperations = Array.isArray(oneOrMany) ? oneOrMany : [oneOrMany];
    const kind = setOperations[0].kind;
    const includeAny = kind !== "intersection";
    const processedSetOperations = new Set();
    const members = new Set();
    let attributes = TypeAttributes_1.emptyTypeAttributes;
    function process(t) {
        if (t.kind === kind) {
            const so = t;
            if (processedSetOperations.has(so))
                return;
            processedSetOperations.add(so);
            if (combinationKind !== undefined) {
                attributes = TypeAttributes_1.combineTypeAttributes(combinationKind, attributes, t.getAttributes());
            }
            for (const m of so.members) {
                process(m);
            }
        }
        else if (includeAny || t.kind !== "any") {
            members.add(t);
        }
        else {
            if (combinationKind !== undefined) {
                attributes = TypeAttributes_1.combineTypeAttributes(combinationKind, attributes, t.getAttributes());
            }
        }
    }
    for (const so of setOperations) {
        process(so);
    }
    return [members, attributes];
}
exports.setOperationMembersRecursively = setOperationMembersRecursively;
function makeGroupsToFlatten(setOperations, include) {
    const typeGroups = new collection_utils_1.EqualityMap();
    for (const u of setOperations) {
        // FIXME: We shouldn't have to make a new set here once we got rid
        // of immutable.
        const members = new Set(setOperationMembersRecursively(u, undefined)[0]);
        if (include !== undefined) {
            if (!include(members))
                continue;
        }
        let maybeSet = typeGroups.get(members);
        if (maybeSet === undefined) {
            maybeSet = new Set();
            if (members.size === 1) {
                maybeSet.add(Support_1.defined(collection_utils_1.iterableFirst(members)));
            }
        }
        maybeSet.add(u);
        typeGroups.set(members, maybeSet);
    }
    return Array.from(typeGroups.values()).map(ts => Array.from(ts));
}
exports.makeGroupsToFlatten = makeGroupsToFlatten;
function combineTypeAttributesOfTypes(combinationKind, types) {
    return TypeAttributes_1.combineTypeAttributes(combinationKind, Array.from(types).map(t => t.getAttributes()));
}
exports.combineTypeAttributesOfTypes = combineTypeAttributesOfTypes;
function isAnyOrNull(t) {
    return t.kind === "any" || t.kind === "null";
}
exports.isAnyOrNull = isAnyOrNull;
// FIXME: We shouldn't have to sort here.  This is just because we're not getting
// back the right order from JSON Schema, due to the changes the intersection types
// introduced.
function removeNullFromUnion(t, sortBy = false) {
    function sort(s) {
        if (sortBy === false)
            return s;
        if (sortBy === true)
            return collection_utils_1.setSortBy(s, m => m.kind);
        return collection_utils_1.setSortBy(s, sortBy);
    }
    const nullType = t.findMember("null");
    if (nullType === undefined) {
        return [null, sort(t.members)];
    }
    return [nullType, sort(collection_utils_1.setFilter(t.members, m => m.kind !== "null"))];
}
exports.removeNullFromUnion = removeNullFromUnion;
function removeNullFromType(t) {
    if (t.kind === "null") {
        return [t, new Set()];
    }
    if (!(t instanceof Type_1.UnionType)) {
        return [null, new Set([t])];
    }
    return removeNullFromUnion(t);
}
exports.removeNullFromType = removeNullFromType;
function nullableFromUnion(t) {
    const [hasNull, nonNulls] = removeNullFromUnion(t);
    if (hasNull === null)
        return null;
    if (nonNulls.size !== 1)
        return null;
    return Support_1.defined(collection_utils_1.iterableFirst(nonNulls));
}
exports.nullableFromUnion = nullableFromUnion;
function nonNullTypeCases(t) {
    return removeNullFromType(t)[1];
}
exports.nonNullTypeCases = nonNullTypeCases;
function getNullAsOptional(cp) {
    const [maybeNull, nonNulls] = removeNullFromType(cp.type);
    if (cp.isOptional) {
        return [true, nonNulls];
    }
    return [maybeNull !== null, nonNulls];
}
exports.getNullAsOptional = getNullAsOptional;
// FIXME: Give this an appropriate name, considering that we don't distinguish
// between named and non-named types anymore.
function isNamedType(t) {
    return ["class", "union", "enum", "object"].indexOf(t.kind) >= 0;
}
exports.isNamedType = isNamedType;
function separateNamedTypes(types) {
    const objects = collection_utils_1.setFilter(types, t => t.kind === "object" || t.kind === "class");
    const enums = collection_utils_1.setFilter(types, t => t instanceof Type_1.EnumType);
    const unions = collection_utils_1.setFilter(types, t => t instanceof Type_1.UnionType);
    return { objects, enums, unions };
}
exports.separateNamedTypes = separateNamedTypes;
function directlyReachableTypes(t, setForType) {
    const set = setForType(t);
    if (set !== null)
        return set;
    return collection_utils_1.setUnion(...Array.from(t.getNonAttributeChildren()).map(c => directlyReachableTypes(c, setForType)));
}
exports.directlyReachableTypes = directlyReachableTypes;
function directlyReachableSingleNamedType(type) {
    const definedTypes = directlyReachableTypes(type, t => {
        if ((!(t instanceof Type_1.UnionType) && isNamedType(t)) ||
            (t instanceof Type_1.UnionType && nullableFromUnion(t) === null)) {
            return new Set([t]);
        }
        return null;
    });
    Support_1.assert(definedTypes.size <= 1, "Cannot have more than one defined type per top-level");
    return collection_utils_1.iterableFirst(definedTypes);
}
exports.directlyReachableSingleNamedType = directlyReachableSingleNamedType;
function stringTypesForType(t) {
    Support_1.assert(t.kind === "string", "Only strings can have string types");
    const stringTypes = StringTypes_1.stringTypesTypeAttributeKind.tryGetInAttributes(t.getAttributes());
    if (stringTypes === undefined) {
        return Support_1.panic("All strings must have a string type attribute");
    }
    return stringTypes;
}
exports.stringTypesForType = stringTypesForType;
function matchTypeExhaustive(t, noneType, anyType, nullType, boolType, integerType, doubleType, stringType, arrayType, classType, mapType, objectType, enumType, unionType, transformedStringType) {
    if (t.isPrimitive()) {
        if (Type_1.isPrimitiveStringTypeKind(t.kind)) {
            if (t.kind === "string") {
                return stringType(t);
            }
            return transformedStringType(t);
        }
        const kind = t.kind;
        const f = {
            none: noneType,
            any: anyType,
            null: nullType,
            bool: boolType,
            integer: integerType,
            double: doubleType
        }[kind];
        if (f !== undefined)
            return f(t);
        return Support_1.assertNever(f);
    }
    else if (t instanceof Type_1.ArrayType)
        return arrayType(t);
    else if (t instanceof Type_1.ClassType)
        return classType(t);
    else if (t instanceof Type_1.MapType)
        return mapType(t);
    else if (t instanceof Type_1.ObjectType)
        return objectType(t);
    else if (t instanceof Type_1.EnumType)
        return enumType(t);
    else if (t instanceof Type_1.UnionType)
        return unionType(t);
    return Support_1.panic(`Unknown type ${t.kind}`);
}
exports.matchTypeExhaustive = matchTypeExhaustive;
function matchType(type, anyType, nullType, boolType, integerType, doubleType, stringType, arrayType, classType, mapType, enumType, unionType, transformedStringType) {
    function typeNotSupported(t) {
        return Support_1.panic(`Unsupported type ${t.kind} in non-exhaustive match`);
    }
    /* tslint:disable:strict-boolean-expressions */
    return matchTypeExhaustive(type, typeNotSupported, anyType, nullType, boolType, integerType, doubleType, stringType, arrayType, classType, mapType, typeNotSupported, enumType, unionType, transformedStringType || typeNotSupported);
    /* tslint:enable */
}
exports.matchType = matchType;
function matchCompoundType(t, arrayType, classType, mapType, objectType, unionType) {
    function ignore(_) {
        return;
    }
    return matchTypeExhaustive(t, ignore, ignore, ignore, ignore, ignore, ignore, ignore, arrayType, classType, mapType, objectType, ignore, unionType, ignore);
}
exports.matchCompoundType = matchCompoundType;

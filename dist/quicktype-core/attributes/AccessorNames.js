"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TypeAttributes_1 = require("./TypeAttributes");
const Support_1 = require("../support/Support");
const Messages_1 = require("../Messages");
class AccessorNamesTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("accessorNames");
    }
    makeInferred(_) {
        return undefined;
    }
}
exports.accessorNamesTypeAttributeKind = new AccessorNamesTypeAttributeKind();
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
function lookupKey(accessors, key, language) {
    const entry = accessors.get(key);
    if (entry === undefined)
        return undefined;
    return getFromEntry(entry, language);
}
exports.lookupKey = lookupKey;
function objectPropertyNames(o, language) {
    const accessors = exports.accessorNamesTypeAttributeKind.tryGetInAttributes(o.getAttributes());
    const map = o.getProperties();
    if (accessors === undefined)
        return collection_utils_1.mapMap(map, _ => undefined);
    return collection_utils_1.mapMap(map, (_cp, n) => lookupKey(accessors, n, language));
}
exports.objectPropertyNames = objectPropertyNames;
function enumCaseNames(e, language) {
    const accessors = exports.accessorNamesTypeAttributeKind.tryGetInAttributes(e.getAttributes());
    if (accessors === undefined)
        return collection_utils_1.mapMap(e.cases.entries(), _ => undefined);
    return collection_utils_1.mapMap(e.cases.entries(), c => lookupKey(accessors, c, language));
}
exports.enumCaseNames = enumCaseNames;
function getAccessorName(names, original) {
    const maybeName = names.get(original);
    if (maybeName === undefined)
        return [undefined, false];
    return maybeName;
}
exports.getAccessorName = getAccessorName;
// Union members can be recombined and reordered, and unions are combined as well, so
// we can't just store an array of accessor entries in a union, one array entry for each
// union member.  Instead, we give each union in the origin type graph a union identifier,
// and each union member type gets a map from union identifiers to accessor entries.
// That way, no matter how the types are recombined, if we find a union member, we can look
// up its union's identifier(s), and then look up the member's accessor entries for that
// identifier.  Of course we might find more than one, potentially conflicting.
class UnionIdentifierTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("unionIdentifier");
    }
    combine(arr) {
        return collection_utils_1.setUnionManyInto(new Set(), arr);
    }
    makeInferred(_) {
        return new Set();
    }
}
exports.unionIdentifierTypeAttributeKind = new UnionIdentifierTypeAttributeKind();
let nextUnionIdentifier = 0;
function makeUnionIdentifierAttribute() {
    const attributes = exports.unionIdentifierTypeAttributeKind.makeAttributes(new Set([nextUnionIdentifier]));
    nextUnionIdentifier += 1;
    return attributes;
}
exports.makeUnionIdentifierAttribute = makeUnionIdentifierAttribute;
class UnionMemberNamesTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("unionMemberNames");
    }
    combine(arr) {
        const result = new Map();
        for (const m of arr) {
            collection_utils_1.mapMergeInto(result, m);
        }
        return result;
    }
}
exports.unionMemberNamesTypeAttributeKind = new UnionMemberNamesTypeAttributeKind();
function makeUnionMemberNamesAttribute(unionAttributes, entry) {
    const identifiers = Support_1.defined(exports.unionIdentifierTypeAttributeKind.tryGetInAttributes(unionAttributes));
    const map = collection_utils_1.mapFromIterable(identifiers, _ => entry);
    return exports.unionMemberNamesTypeAttributeKind.makeAttributes(map);
}
exports.makeUnionMemberNamesAttribute = makeUnionMemberNamesAttribute;
function unionMemberName(u, member, language) {
    const identifiers = exports.unionIdentifierTypeAttributeKind.tryGetInAttributes(u.getAttributes());
    if (identifiers === undefined)
        return [undefined, false];
    const memberNames = exports.unionMemberNamesTypeAttributeKind.tryGetInAttributes(member.getAttributes());
    if (memberNames === undefined)
        return [undefined, false];
    const names = new Set();
    const fixedNames = new Set();
    for (const i of identifiers) {
        const maybeEntry = memberNames.get(i);
        if (maybeEntry === undefined)
            continue;
        const maybeName = getFromEntry(maybeEntry, language);
        if (maybeName === undefined)
            continue;
        const [name, isNameFixed] = maybeName;
        if (isNameFixed) {
            fixedNames.add(name);
        }
        else {
            names.add(name);
        }
    }
    let size;
    let isFixed;
    let first = collection_utils_1.iterableFirst(fixedNames);
    if (first !== undefined) {
        size = fixedNames.size;
        isFixed = true;
    }
    else {
        first = collection_utils_1.iterableFirst(names);
        if (first === undefined)
            return [undefined, false];
        size = names.size;
        isFixed = false;
    }
    Messages_1.messageAssert(size === 1, "SchemaMoreThanOneUnionMemberName", { names: Array.from(names) });
    return [first, isFixed];
}
exports.unionMemberName = unionMemberName;
function isAccessorEntry(x) {
    if (typeof x === "string") {
        return true;
    }
    return Support_1.isStringMap(x, (v) => typeof v === "string");
}
function makeAccessorEntry(ae) {
    if (typeof ae === "string")
        return ae;
    return collection_utils_1.mapFromObject(ae);
}
function makeAccessorNames(x) {
    // FIXME: Do proper error reporting
    const stringMap = Support_1.checkStringMap(x, isAccessorEntry);
    return collection_utils_1.mapMap(collection_utils_1.mapFromObject(stringMap), makeAccessorEntry);
}
exports.makeAccessorNames = makeAccessorNames;
function accessorNamesAttributeProducer(schema, canonicalRef, _types, cases) {
    if (typeof schema !== "object")
        return undefined;
    const maybeAccessors = schema["qt-accessors"];
    if (maybeAccessors === undefined)
        return undefined;
    if (cases === undefined) {
        return { forType: exports.accessorNamesTypeAttributeKind.makeAttributes(makeAccessorNames(maybeAccessors)) };
    }
    else {
        const identifierAttribute = makeUnionIdentifierAttribute();
        const accessors = Support_1.checkArray(maybeAccessors, isAccessorEntry);
        Messages_1.messageAssert(cases.length === accessors.length, "SchemaWrongAccessorEntryArrayLength", {
            operation: "oneOf",
            ref: canonicalRef.push("oneOf")
        });
        const caseAttributes = accessors.map(accessor => makeUnionMemberNamesAttribute(identifierAttribute, makeAccessorEntry(accessor)));
        return { forUnion: identifierAttribute, forCases: caseAttributes };
    }
}
exports.accessorNamesAttributeProducer = accessorNamesAttributeProducer;

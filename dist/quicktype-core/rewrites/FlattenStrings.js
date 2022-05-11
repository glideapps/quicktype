"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TypeUtils_1 = require("../TypeUtils");
const Support_1 = require("../support/Support");
const TypeAttributes_1 = require("../attributes/TypeAttributes");
// A union needs replacing if it contains more than one string type, one of them being
// a basic string type.
function unionNeedsReplacing(u) {
    const stringMembers = u.stringTypeMembers;
    if (stringMembers.size <= 1)
        return undefined;
    const stringType = u.findMember("string");
    if (stringType === undefined)
        return undefined;
    Support_1.assert(!TypeUtils_1.stringTypesForType(stringType).isRestricted, "We must only flatten strings if we have no restriced strings");
    return stringMembers;
}
// Replaces all string types in an enum with the basic string type.
function replaceUnion(group, builder, forwardingRef) {
    Support_1.assert(group.size === 1);
    const u = Support_1.defined(collection_utils_1.iterableFirst(group));
    const stringMembers = Support_1.defined(unionNeedsReplacing(u));
    const stringAttributes = TypeUtils_1.combineTypeAttributesOfTypes("union", stringMembers);
    const types = [];
    for (const t of u.members) {
        if (stringMembers.has(t))
            continue;
        types.push(builder.reconstituteType(t));
    }
    if (types.length === 0) {
        return builder.getStringType(TypeAttributes_1.combineTypeAttributes("union", stringAttributes, u.getAttributes()), undefined, forwardingRef);
    }
    types.push(builder.getStringType(stringAttributes, undefined));
    return builder.getUnionType(u.getAttributes(), new Set(types), forwardingRef);
}
function flattenStrings(graph, stringTypeMapping, debugPrintReconstitution) {
    const allUnions = graph.allNamedTypesSeparated().unions;
    const unionsToReplace = Array.from(allUnions)
        .filter(unionNeedsReplacing)
        .map(t => [t]);
    return graph.rewrite("flatten strings", stringTypeMapping, false, unionsToReplace, debugPrintReconstitution, replaceUnion);
}
exports.flattenStrings = flattenStrings;

"use strict";

import { Set, OrderedSet } from "immutable";

import { PrimitiveType, UnionType, Type } from "./Type";
import { stringTypesForType, combineTypeAttributesOfTypes } from "./TypeUtils";
import { TypeGraph } from "./TypeGraph";
import { TypeRef, StringTypeMapping } from "./TypeBuilder";
import { GraphRewriteBuilder } from "./GraphRewriting";
import { assert, defined } from "./Support";
import { combineTypeAttributes } from "./TypeAttributes";

// A union needs replacing if it contains more than one string type, one of them being
// a basic string type.
function unionNeedsReplacing(u: UnionType): OrderedSet<Type> | undefined {
    const stringMembers = u.stringTypeMembers;
    if (stringMembers.size <= 1) return undefined;
    const stringType = u.findMember("string");
    if (stringType === undefined) return undefined;
    assert(
        !stringTypesForType(stringType as PrimitiveType).isRestricted,
        "We must only flatten strings if we have no restriced strings"
    );
    return stringMembers;
}

// Replaces all string types in an enum with the basic string type.
function replaceUnion(group: Set<UnionType>, builder: GraphRewriteBuilder<UnionType>, forwardingRef: TypeRef): TypeRef {
    assert(group.size === 1);
    const u = defined(group.first());
    const stringMembers = defined(unionNeedsReplacing(u));
    const stringAttributes = combineTypeAttributesOfTypes("union", stringMembers);
    const types: TypeRef[] = [];
    u.members.forEach(t => {
        if (stringMembers.has(t)) return;
        types.push(builder.reconstituteType(t));
    });
    if (types.length === 0) {
        return builder.getStringType(
            combineTypeAttributes("union", stringAttributes, u.getAttributes()),
            undefined,
            forwardingRef
        );
    }
    types.push(builder.getStringType(stringAttributes, undefined));
    return builder.getUnionType(u.getAttributes(), OrderedSet(types), forwardingRef);
}

export function flattenStrings(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintReconstitution: boolean
): TypeGraph {
    const allUnions = graph.allNamedTypesSeparated().unions;
    const unionsToReplace = allUnions
        .filter(unionNeedsReplacing)
        .map(t => [t])
        .toArray();
    return graph.rewrite(
        "flatten strings",
        stringTypeMapping,
        false,
        unionsToReplace,
        debugPrintReconstitution,
        replaceUnion
    );
}

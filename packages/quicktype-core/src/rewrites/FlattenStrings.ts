import { iterableFirst } from "collection-utils";

import { combineTypeAttributes } from "../attributes/TypeAttributes.js";
import type { GraphRewriteBuilder } from "../GraphRewriting.js";
import { assert, defined } from "../support/Support.js";
import type { PrimitiveType, Type, UnionType } from "../Type/Type.js";
import type { StringTypeMapping } from "../Type/TypeBuilderUtils.js";
import type { TypeGraph } from "../Type/TypeGraph.js";
import type { TypeRef } from "../Type/TypeRef.js";
import {
    combineTypeAttributesOfTypes,
    stringTypesForType,
} from "../Type/TypeUtils.js";

// A union needs replacing if it contains more than one string type, one of them being
// a basic string type.
function unionNeedsReplacing(u: UnionType): ReadonlySet<Type> | undefined {
    const stringMembers = u.stringTypeMembers;
    if (stringMembers.size <= 1) return undefined;
    const stringType = u.findMember("string");
    if (stringType === undefined) return undefined;
    assert(
        !stringTypesForType(stringType as PrimitiveType).isRestricted,
        "We must only flatten strings if we have no restriced strings",
    );
    return stringMembers;
}

// Replaces all string types in an enum with the basic string type.
function replaceUnion(
    group: ReadonlySet<UnionType>,
    builder: GraphRewriteBuilder<UnionType>,
    forwardingRef: TypeRef,
): TypeRef {
    assert(group.size === 1);
    const u = defined(iterableFirst(group));
    const stringMembers = defined(unionNeedsReplacing(u));
    const stringAttributes = combineTypeAttributesOfTypes(
        "union",
        stringMembers,
    );
    const types: TypeRef[] = [];
    for (const t of u.members) {
        if (stringMembers.has(t)) continue;
        types.push(builder.reconstituteType(t));
    }

    if (types.length === 0) {
        return builder.getStringType(
            combineTypeAttributes("union", stringAttributes, u.getAttributes()),
            undefined,
            forwardingRef,
        );
    }

    types.push(builder.getStringType(stringAttributes, undefined));
    return builder.getUnionType(
        u.getAttributes(),
        new Set(types),
        forwardingRef,
    );
}

export function flattenStrings(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintReconstitution: boolean,
): TypeGraph {
    const allUnions = graph.allNamedTypesSeparated().unions;
    const unionsToReplace = Array.from(allUnions)
        .filter(unionNeedsReplacing)
        .map((t) => [t]);
    return graph.rewrite(
        "flatten strings",
        stringTypeMapping,
        false,
        unionsToReplace,
        debugPrintReconstitution,
        replaceUnion,
    );
}

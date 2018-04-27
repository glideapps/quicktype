"use strict";

import { Set, OrderedMap, OrderedSet } from "immutable";

import { Type, PrimitiveType, UnionType } from "./Type";
import { combineTypeAttributesOfTypes, stringEnumCases } from "./TypeUtils";
import { TypeGraph } from "./TypeGraph";
import { TypeRef, StringTypeMapping } from "./TypeBuilder";
import { GraphRewriteBuilder } from "./GraphRewriting";
import { assert, defined } from "./Support";
import { combineTypeAttributes } from "./TypeAttributes";
import { stringTypesTypeAttributeKind, StringTypes } from "./StringTypes";

const MIN_LENGTH_FOR_ENUM = 10;

function shouldBeEnum(enumCases: OrderedMap<string, number>): boolean {
    assert(enumCases.size > 0, "How did we end up with zero enum cases?");
    const someCaseIsNotNumber = enumCases.keySeq().some(key => /^(\-|\+)?[0-9]+(\.[0-9]+)?$/.test(key) === false);
    const numValues = enumCases.map(n => n).reduce<number>((a, b) => a + b);
    return numValues >= MIN_LENGTH_FOR_ENUM && enumCases.size < Math.sqrt(numValues) && someCaseIsNotNumber;
}

// A union needs replacing if it contains more than one string type, one of them being
// a basic string type.
function unionNeedsReplacing(u: UnionType): OrderedSet<Type> | undefined {
    const stringMembers = u.stringTypeMembers;
    if (stringMembers.size <= 1) return undefined;
    if (u.findMember("string") === undefined) return undefined;
    return stringMembers;
}

// Replaces all string types in an enum with the basic string type.
function replaceUnion(group: Set<UnionType>, builder: GraphRewriteBuilder<UnionType>, forwardingRef: TypeRef): TypeRef {
    assert(group.size === 1);
    const u = defined(group.first());
    const stringMembers = defined(unionNeedsReplacing(u));
    const stringAttributes = combineTypeAttributesOfTypes(stringMembers);
    const types: TypeRef[] = [];
    u.members.forEach(t => {
        if (stringMembers.has(t)) return;
        types.push(builder.reconstituteType(t));
    });
    if (types.length === 0) {
        return builder.getStringType(
            combineTypeAttributes(stringAttributes, u.getAttributes()),
            undefined,
            forwardingRef
        );
    }
    types.push(builder.getStringType(stringAttributes, undefined));
    return builder.getUnionType(u.getAttributes(), OrderedSet(types), forwardingRef);
}

export function inferEnums(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    makeAllEnums: boolean,
    debugPrintReconstitution: boolean
): TypeGraph {
    function replaceString(
        group: Set<PrimitiveType>,
        builder: GraphRewriteBuilder<PrimitiveType>,
        forwardingRef: TypeRef
    ): TypeRef {
        assert(group.size === 1);
        const t = defined(group.first());
        const attributes = t.getAttributes().filterNot((_, k) => k === stringTypesTypeAttributeKind);
        const enumCases = defined(stringEnumCases(t));
        if (makeAllEnums || shouldBeEnum(enumCases)) {
            return builder.getEnumType(attributes, enumCases.keySeq().toOrderedSet(), forwardingRef);
        }
        return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
    }

    const allStrings = graph
        .allTypesUnordered()
        .filter(t => t.kind === "string" && stringEnumCases(t as PrimitiveType) !== undefined)
        .map(t => [t])
        .toArray() as PrimitiveType[][];
    return graph.rewrite("infer enums", stringTypeMapping, false, allStrings, debugPrintReconstitution, replaceString);
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

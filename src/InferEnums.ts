"use strict";

import { Set, OrderedMap, OrderedSet } from "immutable";

import { Type, StringType, UnionType } from "./Type";
import { combineTypeAttributesOfTypes } from "./TypeUtils";
import { TypeGraph } from "./TypeGraph";
import { TypeRef } from "./TypeBuilder";
import { GraphRewriteBuilder } from "./GraphRewriting";
import { assert, defined } from "./Support";
import { combineTypeAttributes } from "./TypeAttributes";

const MIN_LENGTH_FOR_ENUM = 10;

function shouldBeEnum(t: StringType): OrderedMap<string, number> | undefined {
    const enumCases = t.enumCases;
    if (enumCases !== undefined) {
        assert(enumCases.size > 0, "How did we end up with zero enum cases?");
        const numValues = enumCases.map(n => n).reduce<number>((a, b) => a + b);
        if (numValues >= MIN_LENGTH_FOR_ENUM && enumCases.size < Math.sqrt(numValues)) {
            return t.enumCases;
        }
    }
    return undefined;
}

function replaceString(
    group: Set<StringType>,
    builder: GraphRewriteBuilder<StringType>,
    forwardingRef: TypeRef
): TypeRef {
    assert(group.size === 1);
    const t = defined(group.first());
    const attributes = t.getAttributes();
    const maybeEnumCases = shouldBeEnum(t);
    if (maybeEnumCases !== undefined) {
        return builder.getEnumType(attributes, maybeEnumCases.keySeq().toOrderedSet(), undefined, forwardingRef);
    }
    return builder.getStringType(attributes, undefined, undefined, forwardingRef);
}

// A union needs replacing if it contains more than one string type, one of them being
// a basic string type.
function unionNeedsReplacing(u: UnionType): OrderedSet<Type> | undefined {
    const stringMembers = u.stringTypeMembers.filter(t => t.transformation === undefined);
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
            undefined,
            forwardingRef
        );
    }
    types.push(builder.getStringType(stringAttributes, undefined));
    return builder.getUnionType(u.getAttributes(), OrderedSet(types), undefined, forwardingRef);
}

export function inferEnums(graph: TypeGraph, debugPrintReconstitution: boolean): TypeGraph {
    const allStrings = graph
        .allTypesUnordered()
        .filter(t => t instanceof StringType && t.transformation === undefined)
        .map(t => [t])
        .toArray() as StringType[][];
    return graph.rewrite("infer enums", false, allStrings, debugPrintReconstitution, replaceString);
}

export function flattenStrings(graph: TypeGraph, debugPrintReconstitution: boolean): TypeGraph {
    const allUnions = graph.allNamedTypesSeparated().unions;
    const unionsToReplace = allUnions
        .filter(unionNeedsReplacing)
        .map(t => [t])
        .toArray();
    return graph.rewrite("flatten strings", false, unionsToReplace, debugPrintReconstitution, replaceUnion);
}

"use strict";

import { Set, OrderedMap, OrderedSet } from "immutable";

import { Type, StringType, UnionType } from "./Type";
import { TypeGraph } from "./TypeGraph";
import { GraphRewriteBuilder, TypeRef, StringTypeMapping } from "./TypeBuilder";
import { assert, defined, assertNever } from "./Support";
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
    t: StringType,
    builder: GraphRewriteBuilder<StringType | UnionType>,
    forwardingRef: TypeRef
): TypeRef {
    const attributes = t.getAttributes();
    const maybeEnumCases = shouldBeEnum(t);
    if (maybeEnumCases !== undefined) {
        return builder.getEnumType(attributes, maybeEnumCases.keySeq().toOrderedSet(), forwardingRef);
    }
    return builder.getStringType(attributes, undefined, forwardingRef);
}

// A union needs replacing if it contains more than one string type, one of them being
// a basic string type that won't be converted into an enum.
function unionNeedsReplacing(u: UnionType): OrderedSet<Type> | undefined {
    const stringMembers = u.stringTypeMembers;
    if (stringMembers.size <= 1) return undefined;
    const stringType = u.findMember("string");
    if (stringType === undefined || shouldBeEnum(stringType as StringType) !== undefined) return undefined;
    return stringMembers;
}

// Replaces all string types in an enum with the basic string type.
function replaceUnion(
    u: UnionType,
    builder: GraphRewriteBuilder<StringType | UnionType>,
    forwardingRef: TypeRef
): TypeRef {
    const stringMembers = defined(unionNeedsReplacing(u));
    const stringAttributes = combineTypeAttributes(stringMembers.map(t => t.getAttributes()).toArray());
    const types: TypeRef[] = [];
    u.members.forEach(t => {
        if (stringMembers.has(t)) return;
        types.push(builder.reconstituteType(t));
    });
    if (types.length === 0) {
        return builder.getStringType(
            combineTypeAttributes([stringAttributes, u.getAttributes()]),
            undefined,
            forwardingRef
        );
    }
    types.push(builder.getStringType(stringAttributes, undefined));
    return builder.getUnionType(u.getAttributes(), OrderedSet(types), forwardingRef);
}

function replace(
    setOfStringOrUnion: Set<StringType | UnionType>,
    builder: GraphRewriteBuilder<StringType | UnionType>,
    forwardingRef: TypeRef
): TypeRef {
    assert(setOfStringOrUnion.size === 1);
    const t = defined(setOfStringOrUnion.first());
    if (t instanceof StringType) {
        return replaceString(t, builder, forwardingRef);
    } else if (t instanceof UnionType) {
        return replaceUnion(t, builder, forwardingRef);
    } else {
        return assertNever(t);
    }
}

export function inferEnums(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    const allStrings = graph
        .allTypesUnordered()
        .filter(t => t instanceof StringType)
        .map(t => [t])
        .toArray() as StringType[][];
    const allUnions = graph.allNamedTypesSeparated().unions;
    const unionsToReplace = allUnions
        .filter(unionNeedsReplacing)
        .map(t => [t])
        .toArray();
    const typesToReplace = ([] as (StringType | UnionType)[][]).concat(allStrings, unionsToReplace);
    return graph.rewrite(stringTypeMapping, false, typesToReplace, replace);
}

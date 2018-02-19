"use strict";

import { Set, Map, OrderedSet } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { Type, UnionType } from "./Type";
import { assert, defined } from "./Support";
import { TypeRef, GraphRewriteBuilder, StringTypeMapping } from "./TypeBuilder";
import { combineTypeAttributes } from "./TypeAttributes";
import { unifyTypes, unionBuilderForUnification } from "./UnifyClasses";

function unionMembersRecursively(...unions: UnionType[]): OrderedSet<Type> {
    let processedUnions = Set<UnionType>();
    let members = OrderedSet<Type>();

    function addMembers(u: UnionType): void {
        if (processedUnions.has(u)) return;
        processedUnions = processedUnions.add(u);
        u.members.forEach(t => {
            if (t instanceof UnionType) {
                addMembers(t);
            } else {
                members = members.add(t);
            }
        });
    }

    for (const union of unions) {
        addMembers(union);
    }
    return members;
}

export function flattenUnions(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    conflateNumbers: boolean
): TypeGraph {
    function replace(types: Set<Type>, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef): TypeRef {
        const attributes = combineTypeAttributes(types.map(t => t.getAttributes()).toArray());
        return unifyTypes(
            types,
            attributes,
            builder,
            unionBuilderForUnification(builder, true, true, conflateNumbers),
            conflateNumbers,
            forwardingRef
        );
    }

    const unions = graph.allTypesUnordered().filter(t => t instanceof UnionType) as Set<UnionType>;
    let singleTypeGroups = Map<Type, OrderedSet<Type>>();
    const groups: Type[][] = [];
    unions.forEach(u => {
        const members = unionMembersRecursively(u);
        assert(!members.isEmpty(), "We can't have an empty union");
        if (members.size === 1) {
            const t = defined(members.first());
            let maybeSet = singleTypeGroups.get(t);
            if (maybeSet === undefined) {
                maybeSet = OrderedSet([t]);
            }
            maybeSet = maybeSet.add(u);
            singleTypeGroups = singleTypeGroups.set(t, maybeSet);
        } else {
            groups.push([u]);
        }
    });
    singleTypeGroups.forEach(ts => groups.push(ts.toArray()));

    return graph.rewrite(stringTypeMapping, false, groups, replace);
}

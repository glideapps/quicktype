"use strict";

import { Set, Map, OrderedSet } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { Type, UnionType, IntersectionType } from "./Type";
import { assert, defined } from "./Support";
import { TypeRef, GraphRewriteBuilder, StringTypeMapping } from "./TypeBuilder";
import { combineTypeAttributes } from "./TypeAttributes";
import { unifyTypes, UnifyUnionBuilder } from "./UnifyClasses";

function unionMembersRecursively(...types: Type[]): [OrderedSet<Type>, OrderedSet<UnionType>] {
    let processedUnions = OrderedSet<UnionType>();
    let members = OrderedSet<Type>();

    function addMembers(t: Type): void {
        if (!(t instanceof UnionType)) {
            members = members.add(t);
            return;
        }
        if (processedUnions.has(t)) return;
        processedUnions = processedUnions.add(t);
        t.members.forEach(addMembers);
    }

    types.forEach(addMembers);
    return [members, processedUnions];
}

export function flattenUnions(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    conflateNumbers: boolean
): [TypeGraph, boolean] {
    let needsRepeat = false;

    function replace(types: Set<Type>, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef): TypeRef {
        const unionBuilder = new UnifyUnionBuilder(builder, true, true, (trefs, attributes) => {
            assert(trefs.length > 0, "Must have at least one type to build union");
            trefs = trefs.map(tref => builder.reconstituteType(tref.deref()[0]));
            if (trefs.length === 1) {
                return trefs[0];
            }
            needsRepeat = true;
            return builder.getUnionType(attributes, OrderedSet(trefs));
        });
        const [nonUnions, unions] = unionMembersRecursively(...types.toArray());
        const unionAttributes = combineTypeAttributes(unions.map(t => t.getAttributes()).toArray());
        assert(!nonUnions.isEmpty());
        if (nonUnions.size === 1) {
            const tref = builder.forceReconstituteType(defined(nonUnions.first()).typeRef, forwardingRef);
            builder.addAttributes(tref, unionAttributes);
            return tref;
        }
        return unifyTypes(nonUnions, unionAttributes, builder, unionBuilder, conflateNumbers, forwardingRef);
    }

    const allUnions = graph.allTypesUnordered().filter(t => t instanceof UnionType) as Set<UnionType>;
    const nonCanonicalUnions = allUnions.filter(u => !u.isCanonical);
    let singleTypeGroups = Map<Type, OrderedSet<Type>>();
    const groups: Type[][] = [];
    let foundIntersection: boolean = false;
    nonCanonicalUnions.forEach(u => {
        const [members, unionMembers] = unionMembersRecursively(u);
        assert(!members.isEmpty(), "We can't have an empty union");
        if (members.some(m => m instanceof IntersectionType)) {
            foundIntersection = true;
            return;
        }
        if (members.size === 1) {
            const t = defined(members.first());
            let maybeSet = singleTypeGroups.get(t);
            if (maybeSet === undefined) {
                maybeSet = OrderedSet([t]);
            }
            maybeSet = maybeSet.union(unionMembers);
            singleTypeGroups = singleTypeGroups.set(t, maybeSet);
        } else {
            groups.push([u]);
        }
    });
    singleTypeGroups.forEach(ts => groups.push(ts.toArray()));
    graph = graph.rewrite(stringTypeMapping, false, groups, replace);

    // console.log(`flattened ${nonCanonicalUnions.size} of ${unions.size} unions`);
    return [graph, !needsRepeat && !foundIntersection];
}

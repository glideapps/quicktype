import { TypeGraph, TypeRef, derefTypeRef } from "../TypeGraph";
import { Type, UnionType, IntersectionType } from "../Type";
import { makeGroupsToFlatten } from "../TypeUtils";
import { assert } from "../support/Support";
import { StringTypeMapping } from "../TypeBuilder";
import { GraphRewriteBuilder } from "../GraphRewriting";
import { unifyTypes, UnifyUnionBuilder } from "../UnifyClasses";
import { messageAssert } from "../Messages";
import { emptyTypeAttributes } from "../TypeAttributes";
import { setFilter, iterableSome } from "../support/Containers";

export function flattenUnions(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    conflateNumbers: boolean,
    makeObjectTypes: boolean,
    debugPrintReconstitution: boolean
): [TypeGraph, boolean] {
    let needsRepeat = false;

    function replace(types: ReadonlySet<Type>, builder: GraphRewriteBuilder<Type>, forwardingRef: TypeRef): TypeRef {
        const unionBuilder = new UnifyUnionBuilder(builder, makeObjectTypes, true, trefs => {
            assert(trefs.length > 0, "Must have at least one type to build union");
            trefs = trefs.map(tref => builder.reconstituteType(derefTypeRef(tref, graph)));
            if (trefs.length === 1) {
                return trefs[0];
            }
            needsRepeat = true;
            return builder.getUnionType(emptyTypeAttributes, new Set(trefs));
        });
        return unifyTypes(types, emptyTypeAttributes, builder, unionBuilder, conflateNumbers, forwardingRef);
    }

    const allUnions = setFilter(graph.allTypesUnordered(), t => t instanceof UnionType) as Set<UnionType>;
    const nonCanonicalUnions = setFilter(allUnions, u => !u.isCanonical);
    let foundIntersection = false;
    const groups = makeGroupsToFlatten(nonCanonicalUnions, members => {
        messageAssert(members.size > 0, "IRNoEmptyUnions", {});
        if (!iterableSome(members, m => m instanceof IntersectionType)) return true;

        // FIXME: This is stupid.  `flattenUnions` returns true when no more union
        // flattening is necessary, but `resolveIntersections` can introduce new
        // unions that might require flattening, so now `flattenUnions` needs to take
        // that into account.  Either change `resolveIntersections` such that it
        // doesn't introduce non-canonical unions (by using `unifyTypes`), or have
        // some other way to tell whether more work is needed that doesn't require
        // the two passes to know about each other.
        foundIntersection = true;
        return false;
    });
    graph = graph.rewrite("flatten unions", stringTypeMapping, false, groups, debugPrintReconstitution, replace);

    // console.log(`flattened ${nonCanonicalUnions.size} of ${unions.size} unions`);
    return [graph, !needsRepeat && !foundIntersection];
}

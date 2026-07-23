import { iterableSome, setFilter } from "collection-utils";

import { emptyTypeAttributes } from "../attributes/TypeAttributes.js";
import type { GraphRewriteBuilder } from "../GraphRewriting.js";
import { messageAssert } from "../Messages.js";
import { assert } from "../support/Support.js";
import { IntersectionType, type Type, UnionType } from "../Type/Type.js";
import type { StringTypeMapping } from "../Type/TypeBuilderUtils.js";
import type { TypeGraph } from "../Type/TypeGraph.js";
import { type TypeRef, derefTypeRef, typeRefIndex } from "../Type/TypeRef.js";
import { makeGroupsToFlatten } from "../Type/TypeUtils.js";
import { UnifyUnionBuilder, unifyTypes } from "../UnifyClasses.js";

export function flattenUnions(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    conflateNumbers: boolean,
    makeObjectTypes: boolean,
    debugPrintReconstitution: boolean,
): [TypeGraph, boolean] {
    let needsRepeat = false;

    // During flattening, recursive unions can appear again while their replacement
    // is still being built.  For example, flattening `A | M` can later ask for
    // `A | (A | M)` through an array item or object property.  Those are the same
    // union by associativity/idempotence, so remember each in-progress flattened
    // union by a normalized key of its non-union member refs.  Looking up that key
    // lets recursive occurrences reuse the replacement's forwarding ref instead
    // of allocating another finite unrolling of the same cycle.
    const unionKeyToRef = new Map<string, TypeRef>();

    function addUnionKeyAtoms(
        t: Type,
        atoms: Set<number>,
        seen: Set<number>,
    ): void {
        const index = t.index;
        if (seen.has(index)) return;
        seen.add(index);

        if (t instanceof UnionType) {
            for (const m of t.members) {
                addUnionKeyAtoms(m, atoms, seen);
            }
        } else {
            atoms.add(typeRefIndex(t.typeRef));
        }
    }

    function unionKeyForTypes(types: Iterable<Type>): string {
        const atoms = new Set<number>();
        const seen = new Set<number>();
        for (const t of types) {
            addUnionKeyAtoms(t, atoms, seen);
        }

        return Array.from(atoms)
            .sort((a, b) => a - b)
            .join(",");
    }

    function containsIntersection(t: Type, seen: Set<number>): boolean {
        if (seen.has(t.index)) return false;
        seen.add(t.index);

        if (t instanceof IntersectionType) return true;
        if (!(t instanceof UnionType)) return false;

        return iterableSome(t.members, (m) => containsIntersection(m, seen));
    }

    function replace(
        types: ReadonlySet<Type>,
        builder: GraphRewriteBuilder<Type>,
        forwardingRef: TypeRef,
    ): TypeRef {
        unionKeyToRef.set(unionKeyForTypes(types), forwardingRef);

        let unionBuilder: UnifyUnionBuilder;
        const unifyTypeRefs = (trefs: TypeRef[]): TypeRef => {
            assert(
                trefs.length > 0,
                "Must have at least one type to build union",
            );

            const maybeReconstituted = builder.lookupTypeRefs(
                trefs,
                undefined,
                false,
            );
            if (maybeReconstituted !== undefined) {
                return maybeReconstituted;
            }

            const typesToUnify = new Set(
                trefs.map((tref) => derefTypeRef(tref, graph)),
            );
            if (
                iterableSome(typesToUnify, (t) =>
                    containsIntersection(t, new Set()),
                )
            ) {
                trefs = trefs.map((tref) =>
                    builder.reconstituteType(derefTypeRef(tref, graph)),
                );
                if (trefs.length === 1) {
                    return trefs[0];
                }

                needsRepeat = true;
                return builder.getUnionType(
                    emptyTypeAttributes,
                    new Set(trefs),
                );
            }

            const key = unionKeyForTypes(typesToUnify);
            const maybeRef = unionKeyToRef.get(key);
            if (maybeRef !== undefined) {
                return maybeRef;
            }

            return builder.withForwardingRef(
                undefined,
                (nestedForwardingRef) => {
                    unionKeyToRef.set(key, nestedForwardingRef);
                    return unifyTypes(
                        typesToUnify,
                        emptyTypeAttributes,
                        builder,
                        unionBuilder,
                        conflateNumbers,
                        nestedForwardingRef,
                    );
                },
            );
        };

        unionBuilder = new UnifyUnionBuilder(
            builder,
            makeObjectTypes,
            true,
            unifyTypeRefs,
        );
        return unifyTypes(
            types,
            emptyTypeAttributes,
            builder,
            unionBuilder,
            conflateNumbers,
            forwardingRef,
        );
    }

    const allUnions = setFilter(
        graph.allTypesUnordered(),
        (t) => t instanceof UnionType,
    ) as Set<UnionType>;
    const nonCanonicalUnions = setFilter(allUnions, (u) => !u.isCanonical);
    let foundIntersection = false;
    const groups = makeGroupsToFlatten(nonCanonicalUnions, (members) => {
        messageAssert(members.size > 0, "IRNoEmptyUnions", {});
        if (!iterableSome(members, (m) => m instanceof IntersectionType))
            return true;

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
    graph = graph.rewrite(
        "flatten unions",
        stringTypeMapping,
        false,
        groups,
        debugPrintReconstitution,
        replace,
    );

    // console.log(`flattened ${nonCanonicalUnions.size} of ${unions.size} unions`);
    return [graph, !needsRepeat && !foundIntersection];
}

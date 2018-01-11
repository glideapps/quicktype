"use strict";

import { Map, List, Set, OrderedSet, Collection } from "immutable";

import { Type, separateNamedTypes, SeparatedNamedTypes, isNamedType } from "./Type";
import { defined, assert, panic } from "./Support";
import { GraphRewriteBuilder, TypeRef, TypeBuilder, StringTypeMapping, NoStringTypeMapping } from "./TypeBuilder";
import { TypeNames } from "./TypeNames";
import { Graph } from "./Graph";

export class TypeGraph {
    private _typeBuilder?: TypeBuilder;

    // FIXME: OrderedMap?  We lose the order in PureScript right now, though,
    // and maybe even earlier in the TypeScript driver.
    private _topLevels?: Map<string, Type> = Map();

    private _types?: Type[];
    private _typeNames?: (TypeNames | undefined)[];

    constructor(typeBuilder: TypeBuilder) {
        this._typeBuilder = typeBuilder;
    }

    private get isFrozen(): boolean {
        return this._typeBuilder === undefined;
    }

    freeze = (topLevels: Map<string, TypeRef>, types: Type[], typeNames: (TypeNames | undefined)[]): void => {
        assert(!this.isFrozen, "Tried to freeze TypeGraph a second time");
        assert(
            types.every(t => t.typeRef.graph === this),
            "Trying to freeze a graph with types that don't belong in it"
        );
        // The order of these three statements matters.  If we set _typeBuilder
        // to undefined before we deref the TypeRefs, then we need to set _types
        // before, also, because the deref will call into typeAtIndex, which requires
        // either a _typeBuilder or a _types.
        this._types = types;
        this._typeNames = typeNames;
        this._typeBuilder = undefined;
        this._topLevels = topLevels.map(tref => tref.deref()[0]);
    };

    get topLevels(): Map<string, Type> {
        assert(this.isFrozen, "Cannot get top-levels from a non-frozen graph");
        return defined(this._topLevels);
    }

    atIndex(index: number): [Type, TypeNames | undefined] {
        if (this._typeBuilder !== undefined) {
            return this._typeBuilder.atIndex(index);
        }
        return [defined(this._types)[index], defined(this._typeNames)[index]];
    }

    filterTypes(
        predicate: ((t: Type) => boolean) | undefined,
        childrenOfType: ((t: Type) => Collection<any, Type>) | undefined,
        topDown: boolean
    ): OrderedSet<Type> {
        let seen = Set<Type>();
        let types = List<Type>();

        function addFromType(t: Type): void {
            if (seen.has(t)) return;
            seen = seen.add(t);

            const required = predicate === undefined || predicate(t);

            if (topDown && required) {
                types = types.push(t);
            }

            const children = childrenOfType ? childrenOfType(t) : t.children;
            children.forEach(addFromType);

            if (!topDown && required) {
                types = types.push(t);
            }
        }

        this.topLevels.forEach(addFromType);
        return types.toOrderedSet();
    }

    allNamedTypes = (childrenOfType?: (t: Type) => Collection<any, Type>): OrderedSet<Type> => {
        return this.filterTypes(isNamedType, childrenOfType, true);
    };

    allNamedTypesSeparated = (childrenOfType?: (t: Type) => Collection<any, Type>): SeparatedNamedTypes => {
        const types = this.allNamedTypes(childrenOfType);
        return separateNamedTypes(types);
    };

    // Each array in `replacementGroups` is a bunch of types to be replaced by a
    // single new type.  `replacer` is a function that takes a group and a
    // TypeBuilder, and builds a new type with that builder that replaces the group.
    // That particular TypeBuilder will have to take as inputs types in the old
    // graph, but return types in the new graph.  Recursive types must be handled
    // carefully.
    rewrite<T extends Type>(
        stringTypeMapping: StringTypeMapping,
        replacementGroups: T[][],
        replacer: (typesToReplace: Set<T>, builder: GraphRewriteBuilder<T>, forwardingRef: TypeRef) => TypeRef
    ): TypeGraph {
        if (replacementGroups.length === 0) return this;
        return new GraphRewriteBuilder(this, stringTypeMapping, replacementGroups, replacer).finish();
    }

    garbageCollect(): TypeGraph {
        return new GraphRewriteBuilder(this, NoStringTypeMapping, [], (_t, _b) =>
            panic("This shouldn't be called")
        ).finish();
    }

    allTypesUnordered = (): Set<Type> => {
        assert(this.isFrozen, "Tried to get all graph types before it was frozen");
        return Set(defined(this._types));
    };

    makeGraph(invertDirection: boolean, childrenOfType: (t: Type) => OrderedSet<Type>): Graph<Type> {
        return new Graph(defined(this._types), invertDirection, childrenOfType);
    }
}

export function noneToAny(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    const noneTypes = graph.allTypesUnordered().filter(t => t.kind === "none");
    if (noneTypes.size === 0) {
        return graph;
    }
    assert(noneTypes.size === 1, "Cannot have more than one none type");
    return graph.rewrite(stringTypeMapping, [noneTypes.toArray()], (_, builder, forwardingRef) => {
        return builder.getPrimitiveType("any", forwardingRef);
    });
}

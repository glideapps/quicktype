"use strict";

import { Map, List, Set, OrderedSet, Collection } from "immutable";

import { Type, NamedType, separateNamedTypes, SeparatedNamedTypes } from "./Type";
import { defined, assert } from "./Support";
import { GraphRewriteBuilder, TypeRef, TypeBuilder, StringTypeMapping } from "./TypeBuilder";

export class TypeGraph {
    private _typeBuilder?: TypeBuilder;

    // FIXME: OrderedMap?  We lose the order in PureScript right now, though,
    // and maybe even earlier in the TypeScript driver.
    private _topLevels?: Map<string, Type> = Map();

    private _types?: List<Type> = List();

    constructor(typeBuilder: TypeBuilder) {
        this._typeBuilder = typeBuilder;
    }

    private get isFrozen(): boolean {
        return this._typeBuilder === undefined;
    }

    freeze = (topLevels: Map<string, TypeRef>, types: List<Type>): void => {
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
        this._typeBuilder = undefined;
        this._topLevels = topLevels.map(tref => tref.deref());
    };

    get topLevels(): Map<string, Type> {
        assert(this.isFrozen, "Cannot get top-levels from a non-frozen graph");
        return defined(this._topLevels);
    }

    typeAtIndex = (index: number): Type => {
        if (this._typeBuilder !== undefined) {
            return this._typeBuilder.typeAtIndex(index);
        }
        return defined(defined(this._types).get(index));
    };

    filterTypes<T extends Type>(
        predicate: (t: Type) => t is T,
        childrenOfType?: (t: Type) => Collection<any, Type>
    ): OrderedSet<T> {
        let seen = Set<Type>();
        let types = List<T>();

        function addFromType(t: Type): void {
            if (seen.has(t)) return;
            seen = seen.add(t);

            const children = childrenOfType ? childrenOfType(t) : t.children;
            children.forEach(addFromType);
            if (predicate(t)) {
                types = types.push(t);
            }
        }

        this.topLevels.forEach(addFromType);
        return types.reverse().toOrderedSet();
    }

    allNamedTypes = (childrenOfType?: (t: Type) => Collection<any, Type>): OrderedSet<NamedType> => {
        return this.filterTypes<NamedType>((t: Type): t is NamedType => t.isNamedType(), childrenOfType);
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
        replacer: (typesToReplace: Set<T>, builder: GraphRewriteBuilder<T>) => TypeRef
    ): TypeGraph {
        return new GraphRewriteBuilder(this, stringTypeMapping, replacementGroups, replacer).finish();
    }
}

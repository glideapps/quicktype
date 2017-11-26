"use strict";

import { Map, List, Set, OrderedSet, Collection } from "immutable";

import { Type, NamedType, separateNamedTypes, SeparatedNamedTypes } from "./Type";
import { defined, assert } from "./Support";

export class TypeGraph {
    private _frozen: boolean = false;

    // FIXME: OrderedMap?  We lose the order in PureScript right now, though,
    // and maybe even earlier in the TypeScript driver.
    private _topLevels: Map<string, number> = Map();

    private _types: List<Type> = List();

    get topLevels(): Map<string, Type> {
        // assert(this._frozen, "Cannot get top-levels from a non-frozen graph");
        return this._topLevels.map(this.typeAtIndex);
    }

    addTopLevel = (name: string, t: Type): void => {
        assert(!this._frozen, "Cannot add top-level to a frozen graph");
        assert(t.typeGraph === this, "Adding top-level to wrong type graph");
        assert(!this._topLevels.has(name), "Trying to add top-level with existing name");
        this._topLevels = this._topLevels.set(name, t.indexInGraph);
    };

    typeAtIndex = (index: number): Type => {
        // assert(this._frozen, "Cannot get type from a non-frozen graph");
        return defined(this._types.get(index));
    };

    addType = (t: Type): number => {
        assert(!this._frozen, "Cannot add type to a frozen graph");
        const index = this._types.size;
        this._types = this._types.push(t);
        return index;
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

    // FIXME: Replace with a non-mutating solution.  It should look something like this:
    //
    // inputs:
    //    replacementGroups: Type[][]
    //    replacer: (group: Type[], builder: TypeBuilder): Type
    //
    // Each array in `replacementGroups` is a bunch of types to be replaced by a
    // single new type.  `replacer` is a function that takes a group and a
    // TypeBuilder, and builds a new type with that builder that replaces the group.
    // That particular TypeBuilder will have to take as inputs types in the old
    // graph, but return types in the new graph.  Recursive types must be handled
    // carefully.
    alter = (f: (t: Type) => Type): void => {
        this._topLevels = this.topLevels.map(t => f(t).indexInGraph);
    };
}

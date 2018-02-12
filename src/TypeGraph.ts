"use strict";

import { Map, List, Set, OrderedSet, Collection } from "immutable";

import {
    Type,
    separateNamedTypes,
    SeparatedNamedTypes,
    isNamedType,
    ClassType,
    ClassProperty,
    UnionType
} from "./Type";
import { defined, assert, panic } from "./Support";
import { GraphRewriteBuilder, TypeRef, TypeBuilder, StringTypeMapping, NoStringTypeMapping } from "./TypeBuilder";
import { TypeNames, namesTypeAttributeKind } from "./TypeNames";
import { Graph } from "./Graph";
import { TypeAttributeKind, TypeAttributes } from "./TypeAttributes";

export class TypeAttributeStore {
    private _topLevelValues: Map<string, TypeAttributes> = Map();

    constructor(private readonly _typeGraph: TypeGraph, private _values: (TypeAttributes | undefined)[]) {}

    private getTypeIndex(t: Type): number {
        const tref = t.typeRef;
        assert(tref.graph === this._typeGraph, "Using the wrong type attribute store");
        return tref.getIndex();
    }

    attributesForType(t: Type): TypeAttributes {
        const index = this.getTypeIndex(t);
        const maybeAttributes = this._values[index];
        if (maybeAttributes !== undefined) {
            return maybeAttributes;
        }
        return Map();
    }

    attributesForTopLevel(name: string): TypeAttributes {
        const maybeAttributes = this._topLevelValues.get(name);
        if (maybeAttributes !== undefined) {
            return maybeAttributes;
        }
        return Map();
    }

    private setInMap<T>(attributes: TypeAttributes, kind: TypeAttributeKind<T>, value: T): TypeAttributes {
        return attributes.set(kind, value);
    }

    set<T>(kind: TypeAttributeKind<T>, t: Type, value: T): void {
        const index = this.getTypeIndex(t);
        while (index >= this._values.length) {
            this._values.push(undefined);
        }
        this._values[index] = this.setInMap(this.attributesForType(t), kind, value);
    }

    setForTopLevel<T>(kind: TypeAttributeKind<T>, topLevelName: string, value: T): void {
        this._topLevelValues = this._topLevelValues.set(
            topLevelName,
            this.setInMap(this.attributesForTopLevel(topLevelName), kind, value)
        );
    }

    private tryGetInMap<T>(attributes: TypeAttributes, kind: TypeAttributeKind<T>): T | undefined {
        return attributes.get(kind);
    }

    tryGet<T>(kind: TypeAttributeKind<T>, t: Type): T | undefined {
        return this.tryGetInMap(this.attributesForType(t), kind);
    }

    tryGetForTopLevel<T>(kind: TypeAttributeKind<T>, topLevelName: string): T | undefined {
        return this.tryGetInMap(this.attributesForTopLevel(topLevelName), kind);
    }
}

export class TypeAttributeStoreView<T> {
    constructor(
        private readonly _attributeStore: TypeAttributeStore,
        private readonly _definition: TypeAttributeKind<T>
    ) {
    }

    set(t: Type, value: T): void {
        this._attributeStore.set(this._definition, t, value);
    }

    setForTopLevel(name: string, value: T): void {
        this._attributeStore.setForTopLevel(this._definition, name, value);
    }

    tryGet(t: Type): T | undefined {
        return this._attributeStore.tryGet(this._definition, t);
    }

    get(t: Type): T {
        return defined(this.tryGet(t));
    }

    tryGetForTopLevel(name: string): T | undefined {
        return this._attributeStore.tryGetForTopLevel(this._definition, name);
    }

    getForTopLevel(name: string): T {
        return defined(this.tryGetForTopLevel(name));
    }
}

export class TypeGraph {
    private _typeBuilder?: TypeBuilder;
    private _attributeStore: TypeAttributeStore | undefined = undefined;

    // FIXME: OrderedMap?  We lose the order in PureScript right now, though,
    // and maybe even earlier in the TypeScript driver.
    private _topLevels?: Map<string, Type> = Map();

    private _types?: Type[];

    constructor(typeBuilder: TypeBuilder) {
        this._typeBuilder = typeBuilder;
    }

    private get isFrozen(): boolean {
        return this._typeBuilder === undefined;
    }

    get attributeStore(): TypeAttributeStore {
        return defined(this._attributeStore);
    }

    freeze(topLevels: Map<string, TypeRef>, types: Type[], typeAttributes: (TypeAttributes | undefined)[]): void {
        assert(!this.isFrozen, "Tried to freeze TypeGraph a second time");
        assert(
            types.every(t => t.typeRef.graph === this),
            "Trying to freeze a graph with types that don't belong in it"
        );

        this._attributeStore = new TypeAttributeStore(this, typeAttributes);

        // The order of these three statements matters.  If we set _typeBuilder
        // to undefined before we deref the TypeRefs, then we need to set _types
        // before, also, because the deref will call into typeAtIndex, which requires
        // either a _typeBuilder or a _types.
        this._types = types;
        this._typeBuilder = undefined;
        this._topLevels = topLevels.map(tref => tref.deref()[0]);
    }

    get topLevels(): Map<string, Type> {
        assert(this.isFrozen, "Cannot get top-levels from a non-frozen graph");
        return defined(this._topLevels);
    }

    atIndex(index: number): [Type, TypeAttributes] {
        if (this._typeBuilder !== undefined) {
            return this._typeBuilder.atIndex(index);
        }
        const t = defined(this._types)[index];
        return [t, defined(this._attributeStore).attributesForType(t)];
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

            const children = childrenOfType !== undefined ? childrenOfType(t) : t.children;
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
        alphabetizeProperties: boolean,
        replacementGroups: T[][],
        replacer: (typesToReplace: Set<T>, builder: GraphRewriteBuilder<T>, forwardingRef: TypeRef) => TypeRef
    ): TypeGraph {
        if (replacementGroups.length === 0) return this;
        return new GraphRewriteBuilder(
            this,
            stringTypeMapping,
            alphabetizeProperties,
            replacementGroups,
            replacer
        ).finish();
    }

    garbageCollect(alphabetizeProperties: boolean): TypeGraph {
        // console.log("GC");
        return new GraphRewriteBuilder(this, NoStringTypeMapping, alphabetizeProperties, [], (_t, _b) =>
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
    return graph.rewrite(stringTypeMapping, false, [noneTypes.toArray()], (_, builder, forwardingRef) => {
        return builder.getPrimitiveType("any", forwardingRef);
    });
}

export function optionalToNullable(graph: TypeGraph, stringTypeMapping: StringTypeMapping): TypeGraph {
    function rewriteClass(c: ClassType, builder: GraphRewriteBuilder<ClassType>, forwardingRef: TypeRef): TypeRef {
        const properties = c.properties.map((p, name) => {
            const t = p.type;
            let ref: TypeRef;
            if (!p.isOptional || t.isNullable) {
                ref = builder.reconstituteType(t);
            } else {
                const nullType = builder.getPrimitiveType("null");
                let members: OrderedSet<TypeRef>;
                if (t instanceof UnionType) {
                    members = t.members.map(m => builder.reconstituteType(m)).add(nullType);
                } else {
                    members = OrderedSet([builder.reconstituteType(t), nullType]);
                }
                const attributes = namesTypeAttributeKind.setDefaultInAttributes(
                    t.getAttributes(),
                    () => new TypeNames(OrderedSet([name]), OrderedSet(), true)
                );
                ref = builder.getUnionType(attributes, members);
            }
            return new ClassProperty(ref, false);
        });
        if (c.isFixed) {
            return builder.getUniqueClassType(c.getAttributes(), true, properties, forwardingRef);
        } else {
            return builder.getClassType(c.getAttributes(), properties, forwardingRef);
        }
    }

    const classesWithOptional = graph
        .allTypesUnordered()
        .filter(t => t instanceof ClassType && t.properties.some(p => p.isOptional));
    const replacementGroups = classesWithOptional.map(c => [c as ClassType]).toArray();
    if (classesWithOptional.size === 0) {
        return graph;
    }
    return graph.rewrite(stringTypeMapping, false, replacementGroups, (setOfClass, builder, forwardingRef) => {
        assert(setOfClass.size === 1);
        const c = defined(setOfClass.first());
        return rewriteClass(c, builder, forwardingRef);
    });
}

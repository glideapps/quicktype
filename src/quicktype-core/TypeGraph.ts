import { Type, ClassType, UnionType, IntersectionType } from "./Type";
import { separateNamedTypes, SeparatedNamedTypes, isNamedType, combineTypeAttributesOfTypes } from "./TypeUtils";
import { defined, assert, mustNotBeCalled, panic } from "./support/Support";
import { TypeBuilder, StringTypeMapping, NoStringTypeMapping, provenanceTypeAttributeKind } from "./TypeBuilder";
import { GraphRewriteBuilder, GraphRemapBuilder, BaseGraphRewriteBuilder } from "./GraphRewriting";
import { TypeNames, namesTypeAttributeKind } from "./TypeNames";
import { Graph } from "./Graph";
import { TypeAttributeKind, TypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import { messageError } from "./Messages";
import { iterableFirst, setFilter, setUnionManyInto, setSubtract, mapMap, mapSome, setMap } from "./support/Containers";

export type TypeRef = number;

const indexBits = 26;
const indexMask = (1 << indexBits) - 1;
const serialBits = 31 - indexBits;
const serialMask = (1 << serialBits) - 1;

export function isTypeRef(x: any): x is TypeRef {
    return typeof x === "number";
}

export function makeTypeRef(graph: TypeGraph, index: number): TypeRef {
    assert(index <= indexMask, "Too many types in graph");
    return ((graph.serial & serialMask) << indexBits) | index;
}

export function typeRefIndex(tref: TypeRef): number {
    return tref & indexMask;
}

export function assertTypeRefGraph(tref: TypeRef, graph: TypeGraph): void {
    assert(
        ((tref >> indexBits) & serialBits) === (graph.serial & serialBits),
        "Mixing the wrong type reference and graph"
    );
}

function getGraph(graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder): TypeGraph {
    if (graphOrBuilder instanceof TypeGraph) return graphOrBuilder;
    return graphOrBuilder.originalGraph;
}

export function derefTypeRef(tref: TypeRef, graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder): Type {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.typeAtIndex(typeRefIndex(tref));
}

export function attributesForTypeRef(
    tref: TypeRef,
    graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder
): TypeAttributes {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.atIndex(typeRefIndex(tref))[1];
}

export function typeAndAttributesForTypeRef(
    tref: TypeRef,
    graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder
): [Type, TypeAttributes] {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.atIndex(typeRefIndex(tref));
}

export class TypeAttributeStore {
    private readonly _topLevelValues: Map<string, TypeAttributes> = new Map();

    constructor(private readonly _typeGraph: TypeGraph, private _values: (TypeAttributes | undefined)[]) {}

    private getTypeIndex(t: Type): number {
        const tref = t.typeRef;
        assertTypeRefGraph(tref, this._typeGraph);
        return typeRefIndex(tref);
    }

    attributesForType(t: Type): TypeAttributes {
        const index = this.getTypeIndex(t);
        const maybeAttributes = this._values[index];
        if (maybeAttributes !== undefined) {
            return maybeAttributes;
        }
        return emptyTypeAttributes;
    }

    attributesForTopLevel(name: string): TypeAttributes {
        const maybeAttributes = this._topLevelValues.get(name);
        if (maybeAttributes !== undefined) {
            return maybeAttributes;
        }
        return emptyTypeAttributes;
    }

    private setInMap<T>(attributes: TypeAttributes, kind: TypeAttributeKind<T>, value: T): TypeAttributes {
        // FIXME: This is potentially super slow
        return new Map(attributes).set(kind, value);
    }

    set<T>(kind: TypeAttributeKind<T>, t: Type, value: T): void {
        const index = this.getTypeIndex(t);
        while (index >= this._values.length) {
            this._values.push(undefined);
        }
        this._values[index] = this.setInMap(this.attributesForType(t), kind, value);
    }

    setForTopLevel<T>(kind: TypeAttributeKind<T>, topLevelName: string, value: T): void {
        this._topLevelValues.set(topLevelName, this.setInMap(this.attributesForTopLevel(topLevelName), kind, value));
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
    ) {}

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
    private _topLevels: Map<string, Type> = new Map();

    private _types?: Type[];

    private _parents: Set<Type>[] | undefined = undefined;

    private _printOnRewrite: boolean = false;

    constructor(
        typeBuilder: TypeBuilder,
        readonly serial: number,
        private readonly _haveProvenanceAttributes: boolean
    ) {
        this._typeBuilder = typeBuilder;
    }

    private get isFrozen(): boolean {
        return this._typeBuilder === undefined;
    }

    get attributeStore(): TypeAttributeStore {
        return defined(this._attributeStore);
    }

    freeze(
        topLevels: ReadonlyMap<string, TypeRef>,
        types: Type[],
        typeAttributes: (TypeAttributes | undefined)[]
    ): void {
        assert(!this.isFrozen, "Tried to freeze TypeGraph a second time");
        for (const t of types) {
            assertTypeRefGraph(t.typeRef, this);
        }

        this._attributeStore = new TypeAttributeStore(this, typeAttributes);

        // The order of these three statements matters.  If we set _typeBuilder
        // to undefined before we deref the TypeRefs, then we need to set _types
        // before, also, because the deref will call into typeAtIndex, which requires
        // either a _typeBuilder or a _types.
        this._types = types;
        this._typeBuilder = undefined;
        this._topLevels = mapMap(topLevels, tref => derefTypeRef(tref, this));
    }

    get topLevels(): ReadonlyMap<string, Type> {
        assert(this.isFrozen, "Cannot get top-levels from a non-frozen graph");
        return this._topLevels;
    }

    typeAtIndex(index: number): Type {
        if (this._typeBuilder !== undefined) {
            return this._typeBuilder.typeAtIndex(index);
        }
        return defined(this._types)[index];
    }

    atIndex(index: number): [Type, TypeAttributes] {
        if (this._typeBuilder !== undefined) {
            return this._typeBuilder.atIndex(index);
        }
        const t = this.typeAtIndex(index);
        return [t, defined(this._attributeStore).attributesForType(t)];
    }

    private filterTypes(predicate: ((t: Type) => boolean) | undefined): ReadonlySet<Type> {
        const seen = new Set<Type>();
        let types: Type[] = [];

        function addFromType(t: Type): void {
            if (seen.has(t)) return;
            seen.add(t);

            const required = predicate === undefined || predicate(t);

            if (required) {
                types.push(t);
            }

            for (const c of t.getChildren()) {
                addFromType(c);
            }
        }

        for (const [_, t] of this.topLevels) {
            addFromType(t);
        }
        return new Set(types);
    }

    allNamedTypes(): ReadonlySet<Type> {
        return this.filterTypes(isNamedType);
    }

    allNamedTypesSeparated(): SeparatedNamedTypes {
        const types = this.allNamedTypes();
        return separateNamedTypes(types);
    }

    private allProvenance(): ReadonlySet<number> {
        assert(this._haveProvenanceAttributes);

        const view = new TypeAttributeStoreView(this.attributeStore, provenanceTypeAttributeKind);
        const sets = Array.from(this.allTypesUnordered()).map(t => {
            const maybeSet = view.tryGet(t);
            if (maybeSet !== undefined) return maybeSet;
            return new Set();
        });
        const result = new Set();
        setUnionManyInto(result, sets);
        return result;
    }

    setPrintOnRewrite(): void {
        this._printOnRewrite = true;
    }

    private checkLostTypeAttributes(builder: BaseGraphRewriteBuilder, newGraph: TypeGraph): void {
        if (!this._haveProvenanceAttributes || builder.lostTypeAttributes) return;

        const oldProvenance = this.allProvenance();
        const newProvenance = newGraph.allProvenance();
        if (oldProvenance.size !== newProvenance.size) {
            const difference = setSubtract(oldProvenance, newProvenance);
            const indexes = Array.from(difference);
            return messageError("IRTypeAttributesNotPropagated", { count: difference.size, indexes });
        }
    }

    private printRewrite(title: string): void {
        if (!this._printOnRewrite) return;

        console.log(`\n# ${title}`);
    }

    // Each array in `replacementGroups` is a bunch of types to be replaced by a
    // single new type.  `replacer` is a function that takes a group and a
    // TypeBuilder, and builds a new type with that builder that replaces the group.
    // That particular TypeBuilder will have to take as inputs types in the old
    // graph, but return types in the new graph.  Recursive types must be handled
    // carefully.
    rewrite<T extends Type>(
        title: string,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        replacementGroups: T[][],
        debugPrintReconstitution: boolean,
        replacer: (typesToReplace: ReadonlySet<T>, builder: GraphRewriteBuilder<T>, forwardingRef: TypeRef) => TypeRef,
        force: boolean = false
    ): TypeGraph {
        this.printRewrite(title);

        if (!force && replacementGroups.length === 0) return this;

        const builder = new GraphRewriteBuilder(
            this,
            stringTypeMapping,
            alphabetizeProperties,
            this._haveProvenanceAttributes,
            replacementGroups,
            debugPrintReconstitution,
            replacer
        );
        const newGraph = builder.finish();

        this.checkLostTypeAttributes(builder, newGraph);

        if (this._printOnRewrite) {
            newGraph.setPrintOnRewrite();
            newGraph.printGraph();
        }

        if (!builder.didAddForwardingIntersection) return newGraph;

        assert(!force, "We shouldn't have introduced forwarding intersections in a forced rewrite");
        return removeIndirectionIntersections(newGraph, stringTypeMapping, debugPrintReconstitution);
    }

    remap(
        title: string,
        stringTypeMapping: StringTypeMapping,
        alphabetizeProperties: boolean,
        map: ReadonlyMap<Type, Type>,
        debugPrintRemapping: boolean
    ): TypeGraph {
        this.printRewrite(title);

        if (map.size === 0) return this;

        const builder = new GraphRemapBuilder(
            this,
            stringTypeMapping,
            alphabetizeProperties,
            this._haveProvenanceAttributes,
            map,
            debugPrintRemapping
        );
        const newGraph = builder.finish();

        this.checkLostTypeAttributes(builder, newGraph);

        if (this._printOnRewrite) {
            newGraph.setPrintOnRewrite();
            newGraph.printGraph();
        }

        assert(!builder.didAddForwardingIntersection);

        return newGraph;
    }

    garbageCollect(alphabetizeProperties: boolean, debugPrintReconstitution: boolean): TypeGraph {
        const newGraph = this.rewrite(
            "GC",
            NoStringTypeMapping,
            alphabetizeProperties,
            [],
            debugPrintReconstitution,
            (_t, _b) => mustNotBeCalled(),
            true
        );
        // console.log(`GC: ${defined(newGraph._types).length} types`);
        return newGraph;
    }

    allTypesUnordered(): ReadonlySet<Type> {
        assert(this.isFrozen, "Tried to get all graph types before it was frozen");
        return new Set(defined(this._types));
    }

    makeGraph(invertDirection: boolean, childrenOfType: (t: Type) => ReadonlySet<Type>): Graph<Type> {
        return new Graph(defined(this._types), invertDirection, childrenOfType);
    }

    getParentsOfType(t: Type): Set<Type> {
        assertTypeRefGraph(t.typeRef, this);
        if (this._parents === undefined) {
            const parents = defined(this._types).map(_ => new Set());
            for (const p of this.allTypesUnordered()) {
                for (const c of p.getChildren()) {
                    const index = c.index;
                    parents[index] = parents[index].add(p);
                }
            }
            this._parents = parents;
        }
        return this._parents[t.index];
    }

    printGraph(): void {
        const types = defined(this._types);
        for (let i = 0; i < types.length; i++) {
            const t = types[i];
            const parts: string[] = [];
            parts.push(`${t.debugPrintKind}${t.hasNames ? ` ${t.getCombinedName()}` : ""}`);
            const children = t.getChildren();
            if (children.size > 0) {
                parts.push(
                    `children ${Array.from(children)
                        .map(c => c.index)
                        .join(",")}`
                );
            }
            for (const [kind, value] of t.getAttributes()) {
                const maybeString = kind.stringify(value);
                if (maybeString !== undefined) {
                    parts.push(maybeString);
                }
            }
            console.log(`${i}: ${parts.join(" | ")}`);
        }
    }
}

export function noneToAny(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintReconstitution: boolean
): TypeGraph {
    const noneTypes = setFilter(graph.allTypesUnordered(), t => t.kind === "none");
    if (noneTypes.size === 0) {
        return graph;
    }
    assert(noneTypes.size === 1, "Cannot have more than one none type");
    return graph.rewrite(
        "none to any",
        stringTypeMapping,
        false,
        [Array.from(noneTypes)],
        debugPrintReconstitution,
        (types, builder, forwardingRef) => {
            const attributes = combineTypeAttributesOfTypes("union", types);
            const tref = builder.getPrimitiveType("any", attributes, forwardingRef);
            return tref;
        }
    );
}

export function optionalToNullable(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintReconstitution: boolean
): TypeGraph {
    function rewriteClass(c: ClassType, builder: GraphRewriteBuilder<ClassType>, forwardingRef: TypeRef): TypeRef {
        const properties = mapMap(c.getProperties(), (p, name) => {
            const t = p.type;
            let ref: TypeRef;
            if (!p.isOptional || t.isNullable) {
                ref = builder.reconstituteType(t);
            } else {
                const nullType = builder.getPrimitiveType("null");
                let members: ReadonlySet<TypeRef>;
                if (t instanceof UnionType) {
                    members = setMap(t.members, m => builder.reconstituteType(m)).add(nullType);
                } else {
                    members = new Set([builder.reconstituteType(t), nullType]);
                }
                const attributes = namesTypeAttributeKind.setDefaultInAttributes(t.getAttributes(), () =>
                    TypeNames.make(new Set([name]), new Set(), true)
                );
                ref = builder.getUnionType(attributes, members);
            }
            return builder.makeClassProperty(ref, false);
        });
        if (c.isFixed) {
            return builder.getUniqueClassType(c.getAttributes(), true, properties, forwardingRef);
        } else {
            return builder.getClassType(c.getAttributes(), properties, forwardingRef);
        }
    }

    const classesWithOptional = setFilter(
        graph.allTypesUnordered(),
        t => t instanceof ClassType && mapSome(t.getProperties(), p => p.isOptional)
    );
    const replacementGroups = Array.from(classesWithOptional).map(c => [c as ClassType]);
    if (classesWithOptional.size === 0) {
        return graph;
    }
    return graph.rewrite(
        "optional to nullable",
        stringTypeMapping,
        false,
        replacementGroups,
        debugPrintReconstitution,
        (setOfClass, builder, forwardingRef) => {
            assert(setOfClass.size === 1);
            const c = defined(iterableFirst(setOfClass));
            return rewriteClass(c, builder, forwardingRef);
        }
    );
}

export function removeIndirectionIntersections(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    debugPrintRemapping: boolean
): TypeGraph {
    const map: [Type, Type][] = [];

    for (const t of graph.allTypesUnordered()) {
        if (!(t instanceof IntersectionType)) continue;
        const seen = new Set([t]);
        let current = t;
        while (current.members.size === 1) {
            const member = defined(iterableFirst(current.members));
            if (!(member instanceof IntersectionType)) {
                map.push([t, member]);
                break;
            }
            if (seen.has(member)) {
                // FIXME: Technically, this is an any type.
                return panic("There's a cycle of intersection types");
            }
            seen.add(member);
            current = member;
        }
    }

    return graph.remap("remove indirection intersections", stringTypeMapping, false, new Map(map), debugPrintRemapping);
}

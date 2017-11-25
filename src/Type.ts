"use strict";

import { OrderedSet, OrderedMap, Map, Set, Collection, List } from "immutable";
import { defined, panic, assert } from "./Support";
import { TypeGraph } from "./TypeBuilder";

// FIXME: OrderedMap?  We lose the order in PureScript right now, though,
// and maybe even earlier in the TypeScript driver.
export type TopLevels = Map<string, Type>;

export type PrimitiveTypeKind = "any" | "null" | "bool" | "integer" | "double" | "string";
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "map";

export abstract class Type {
    readonly indexInGraph: number;

    constructor(readonly typeGraph: TypeGraph, readonly kind: TypeKind) {
        this.indexInGraph = typeGraph.addType(this);
    }

    isNamedType(): this is NamedType {
        return false;
    }

    abstract get children(): OrderedSet<Type>;

    directlyReachableTypes<T>(setForType: (t: Type) => OrderedSet<T> | null): OrderedSet<T> {
        const set = setForType(this);
        if (set) return set;
        return orderedSetUnion(this.children.map((t: Type) => t.directlyReachableTypes(setForType)));
    }

    abstract get isNullable(): boolean;
    abstract map(f: (t: Type) => Type): Type;

    equals(other: any): boolean {
        if (!Object.prototype.hasOwnProperty.call(other, "indexInGraph")) {
            return false;
        }
        return this.indexInGraph === other.indexInGraph;
    }

    hashCode(): number {
        return this.indexInGraph | 0;
    }
}

export class PrimitiveType extends Type {
    readonly kind: PrimitiveTypeKind;

    constructor(typeGraph: TypeGraph, kind: PrimitiveTypeKind) {
        super(typeGraph, kind);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    get isNullable(): boolean {
        return this.kind === "null";
    }

    map(f: (t: Type) => Type): this {
        return this;
    }
}

function isNull(t: Type): t is PrimitiveType {
    return t.kind === "null";
}

function constituentIndex(container: Type, constituent: Type): number {
    assert(container.typeGraph === constituent.typeGraph, "Container and constituent are not in the same type graph");
    return constituent.indexInGraph;
}

export class ArrayType extends Type {
    readonly kind: "array";
    private readonly _itemsIndex: number;

    constructor(typeGraph: TypeGraph, items: Type) {
        super(typeGraph, "array");
        this._itemsIndex = constituentIndex(this, items);
    }

    get items(): Type {
        return this.typeGraph.typeAtIndex(this._itemsIndex);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.items]);
    }

    get isNullable(): boolean {
        return false;
    }

    map(f: (t: Type) => Type): ArrayType {
        const items = f(this.items);
        if (items === this.items) return this;
        return this.typeGraph.getArrayType(items);
    }
}

export class MapType extends Type {
    readonly kind: "map";
    private readonly _valuesIndex: number;

    constructor(typeGraph: TypeGraph, values: Type) {
        super(typeGraph, "map");
        this._valuesIndex = constituentIndex(this, values);
    }

    get values(): Type {
        return this.typeGraph.typeAtIndex(this._valuesIndex);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet([this.values]);
    }

    get isNullable(): boolean {
        return false;
    }

    map(f: (t: Type) => Type): MapType {
        const values = f(this.values);
        if (values === this.values) return this;
        return this.typeGraph.getMapType(values);
    }
}

// FIXME: In the case of overlapping prefixes and suffixes we will
// produce a name that includes the overlap twice.  For example, for
// the names "aaa" and "aaaa" we have the common prefix "aaa" and the
// common suffix "aaa", so we will produce the combined name "aaaaaa".
function combineNames(names: Collection<any, string>): string {
    const first = names.first();
    if (first === undefined) {
        return panic("Named type has no names");
    }
    if (names.count() === 1) {
        return first;
    }
    let prefixLength = first.length;
    let suffixLength = first.length;
    names.rest().forEach(n => {
        prefixLength = Math.min(prefixLength, n.length);
        for (let i = 0; i < prefixLength; i++) {
            if (first[i] !== n[i]) {
                prefixLength = i;
                break;
            }
        }

        suffixLength = Math.min(suffixLength, n.length);
        for (let i = 0; i < suffixLength; i++) {
            if (first[first.length - i - 1] !== n[n.length - i - 1]) {
                suffixLength = i;
                break;
            }
        }
    });
    const prefix = prefixLength > 2 ? first.substr(0, prefixLength) : "";
    const suffix = suffixLength > 2 ? first.substr(first.length - suffixLength) : "";
    const combined = prefix + suffix;
    if (combined.length > 2) {
        return combined;
    }
    return first;
}

export type NameOrNames = string | OrderedSet<string>;

function setFromNameOrNames(nameOrNames: NameOrNames): OrderedSet<string> {
    if (typeof nameOrNames === "string") {
        return OrderedSet([nameOrNames]);
    } else {
        return nameOrNames;
    }
}

export abstract class NamedType extends Type {
    private _names: OrderedSet<string>;
    private _areNamesInferred: boolean;

    constructor(typeGraph: TypeGraph, kind: NamedTypeKind, nameOrNames: NameOrNames, areNamesInferred: boolean) {
        super(typeGraph, kind);
        this._names = setFromNameOrNames(nameOrNames);
        this._areNamesInferred = areNamesInferred;
    }

    isNamedType(): this is NamedType {
        return true;
    }

    get names(): OrderedSet<string> {
        return this._names;
    }

    get areNamesInferred(): boolean {
        return this._areNamesInferred;
    }

    addNames(nameOrNames: NameOrNames, isInferred: boolean): void {
        if (isInferred && !this._areNamesInferred) {
            return;
        }
        const names = setFromNameOrNames(nameOrNames);
        if (this._areNamesInferred && !isInferred) {
            this._names = names;
            this._areNamesInferred = isInferred;
        } else {
            this._names = this._names.union(names);
        }
    }

    setGivenName(name: string): void {
        this._names = OrderedSet([name]);
        this._areNamesInferred = false;
    }

    get combinedName(): string {
        return combineNames(this._names);
    }
}

export class ClassType extends NamedType {
    kind: "class";
    private _propertyIndexes?: Map<string, number>;

    constructor(typeGraph: TypeGraph, names: NameOrNames, areNamesInferred: boolean, properties?: Map<string, Type>) {
        super(typeGraph, "class", names, areNamesInferred);
        if (properties !== undefined) {
            this.setProperties(properties);
        }
    }

    setProperties(properties: Map<string, Type>): void {
        if (this._propertyIndexes !== undefined) {
            return panic("Can only set class properties once");
        }
        this._propertyIndexes = properties.map(t => constituentIndex(this, t));
    }

    get properties(): Map<string, Type> {
        if (this._propertyIndexes === undefined) {
            return panic("Class properties accessed before they were set");
        }
        return this._propertyIndexes.map(this.typeGraph.typeAtIndex);
    }

    get sortedProperties(): OrderedMap<string, Type> {
        const properties = this.properties;
        const sortedKeys = properties.keySeq().sort();
        const props = sortedKeys.map((k: string): [string, Type] => [k, defined(properties.get(k))]);
        return OrderedMap(props);
    }

    get children(): OrderedSet<Type> {
        return this.sortedProperties.toOrderedSet();
    }

    get isNullable(): boolean {
        return false;
    }

    map(f: (t: Type) => Type): ClassType {
        let same = true;
        const properties = this.properties.map(t => {
            const ft = f(t);
            if (ft !== t) same = false;
            return ft;
        });
        if (same) return this;
        return this.typeGraph.getClassType(this.names, this.areNamesInferred, properties);
    }
}

export class EnumType extends NamedType {
    kind: "enum";

    constructor(
        typeGraph: TypeGraph,
        names: NameOrNames,
        areNamesInferred: boolean,
        readonly cases: OrderedSet<string>
    ) {
        super(typeGraph, "enum", names, areNamesInferred);
    }

    get children(): OrderedSet<Type> {
        return OrderedSet();
    }

    get isNullable(): boolean {
        return false;
    }

    map(f: (t: Type) => Type): this {
        return this;
    }
}

export class UnionType extends NamedType {
    kind: "union";
    private readonly _memberIndexes: OrderedSet<number>;

    constructor(typeGraph: TypeGraph, names: NameOrNames, areNamesInferred: boolean, members: OrderedSet<Type>) {
        super(typeGraph, "union", names, areNamesInferred);
        assert(members.size > 1);
        this._memberIndexes = members.map(t => constituentIndex(this, t));
    }

    get members(): OrderedSet<Type> {
        return this._memberIndexes.map(this.typeGraph.typeAtIndex);
    }

    findMember = (kind: TypeKind): Type | undefined => {
        return this.members.find((t: Type) => t.kind === kind);
    };

    get children(): OrderedSet<Type> {
        return this.sortedMembers;
    }

    get isNullable(): boolean {
        return this.findMember("null") !== undefined;
    }

    map(f: (t: Type) => Type): UnionType {
        let same = true;
        const members = this.members.map(t => {
            const ft = f(t);
            if (ft !== t) same = false;
            return ft;
        });
        if (same) return this;
        return this.typeGraph.getUnionType(this.names, this.areNamesInferred, members);
    }

    get sortedMembers(): OrderedSet<Type> {
        // FIXME: We're assuming no two members of the same kind.
        return this.members.sortBy(t => t.kind);
    }
}

export function removeNullFromUnion(t: UnionType): [PrimitiveType | null, OrderedSet<Type>] {
    const nullType = t.findMember("null");
    if (!nullType) {
        return [null, t.members];
    }
    return [nullType as PrimitiveType, t.members.filterNot(isNull).toOrderedSet()];
}

export function nullableFromUnion(t: UnionType): Type | null {
    const [hasNull, nonNulls] = removeNullFromUnion(t);
    if (!hasNull) return null;
    if (nonNulls.size !== 1) return null;
    return defined(nonNulls.first());
}

export function makeNullable(t: Type, typeNames: NameOrNames, areNamesInferred: boolean): Type {
    if (t.kind === "null") {
        return t;
    }
    const nullType = t.typeGraph.getPrimitiveType("null");
    if (!(t instanceof UnionType)) {
        return t.typeGraph.getUnionType(typeNames, areNamesInferred, OrderedSet([t, nullType]));
    }
    const [maybeNull, nonNulls] = removeNullFromUnion(t);
    if (maybeNull) return t;
    return t.typeGraph.getUnionType(typeNames, areNamesInferred, nonNulls.add(nullType));
}

export function removeNull(t: Type): Type {
    if (!(t instanceof UnionType)) {
        return t;
    }
    const [_, nonNulls] = removeNullFromUnion(t);
    const first = nonNulls.first();
    if (first) {
        if (nonNulls.size === 1) return first;
        return t.typeGraph.getUnionType(t.names, t.areNamesInferred, nonNulls);
    }
    return panic("Trying to remove null results in empty union.");
}

// FIXME: The outer OrderedSet should be some Collection, but I can't figure out
// which one.  Collection.Indexed doesn't work with OrderedSet, which is unfortunate.
function orderedSetUnion<T>(sets: OrderedSet<OrderedSet<T>>): OrderedSet<T> {
    const setArray = sets.toArray();
    if (setArray.length === 0) return OrderedSet();
    if (setArray.length === 1) return setArray[0];
    return setArray[0].union(...setArray.slice(1));
}

export function filterTypes<T extends Type>(
    predicate: (t: Type) => t is T,
    graph: TopLevels,
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

    graph.forEach(addFromType);
    return types.reverse().toOrderedSet();
}

export function allNamedTypes(
    graph: TopLevels,
    childrenOfType?: (t: Type) => Collection<any, Type>
): OrderedSet<NamedType> {
    return filterTypes<NamedType>((t: Type): t is NamedType => t.isNamedType(), graph, childrenOfType);
}

export type SeparatedNamedTypes = {
    classes: OrderedSet<ClassType>;
    enums: OrderedSet<EnumType>;
    unions: OrderedSet<UnionType>;
};

export function separateNamedTypes(types: Collection<any, NamedType>): SeparatedNamedTypes {
    const classes = types.filter((t: NamedType) => t instanceof ClassType).toOrderedSet() as OrderedSet<ClassType>;
    const enums = types.filter((t: NamedType) => t instanceof EnumType).toOrderedSet() as OrderedSet<EnumType>;
    const unions = types.filter((t: NamedType) => t instanceof UnionType).toOrderedSet() as OrderedSet<UnionType>;

    return { classes, enums, unions };
}

export function allNamedTypesSeparated(
    graph: TopLevels,
    childrenOfType?: (t: Type) => Collection<any, Type>
): SeparatedNamedTypes {
    const types = allNamedTypes(graph, childrenOfType);
    return separateNamedTypes(types);
}

export function matchType<U>(
    t: Type,
    anyType: (anyType: PrimitiveType) => U,
    nullType: (nullType: PrimitiveType) => U,
    boolType: (boolType: PrimitiveType) => U,
    integerType: (integerType: PrimitiveType) => U,
    doubleType: (doubleType: PrimitiveType) => U,
    stringType: (stringType: PrimitiveType) => U,
    arrayType: (arrayType: ArrayType) => U,
    classType: (classType: ClassType) => U,
    mapType: (mapType: MapType) => U,
    enumType: (enumType: EnumType) => U,
    unionType: (unionType: UnionType) => U
): U {
    if (t instanceof PrimitiveType) {
        const f = {
            any: anyType,
            null: nullType,
            bool: boolType,
            integer: integerType,
            double: doubleType,
            string: stringType
        }[t.kind];
        if (f) return f(t);
        return panic(`Unknown PrimitiveType: ${t.kind}`);
    } else if (t instanceof ArrayType) return arrayType(t);
    else if (t instanceof ClassType) return classType(t);
    else if (t instanceof MapType) return mapType(t);
    else if (t instanceof EnumType) return enumType(t);
    else if (t instanceof UnionType) return unionType(t);
    return panic("Unknown Type");
}

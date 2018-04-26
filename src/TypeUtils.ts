"use strict";

import { OrderedSet, Collection, Map, Set, OrderedMap } from "immutable";

import { defined, panic, assert, assertNever } from "./Support";
import { TypeAttributes, combineTypeAttributes, emptyTypeAttributes } from "./TypeAttributes";
import {
    Type,
    PrimitiveType,
    ArrayType,
    EnumType,
    ObjectType,
    MapType,
    ClassType,
    ClassProperty,
    SetOperationType,
    UnionType,
    stringEnumCasesTypeAttributeKind
} from "./Type";

export function assertIsObject(t: Type): ObjectType {
    if (t instanceof ObjectType) {
        return t;
    }
    return panic("Supposed object type is not an object type");
}

export function assertIsClass(t: Type): ClassType {
    if (!(t instanceof ClassType)) {
        return panic("Supposed class type is not a class type");
    }
    return t;
}

export function setOperationMembersRecursively<T extends SetOperationType>(
    setOperation: T
): [OrderedSet<Type>, TypeAttributes];
export function setOperationMembersRecursively<T extends SetOperationType>(
    setOperations: T[]
): [OrderedSet<Type>, TypeAttributes];
export function setOperationMembersRecursively<T extends SetOperationType>(
    oneOrMany: T | T[]
): [OrderedSet<Type>, TypeAttributes] {
    const setOperations = Array.isArray(oneOrMany) ? oneOrMany : [oneOrMany];
    const kind = setOperations[0].kind;
    const includeAny = kind !== "intersection";
    let processedSetOperations = Set<T>();
    let members = OrderedSet<Type>();
    let attributes = emptyTypeAttributes;

    function process(t: Type): void {
        if (t.kind === kind) {
            const so = t as T;
            if (processedSetOperations.has(so)) return;
            processedSetOperations = processedSetOperations.add(so);
            attributes = combineTypeAttributes(attributes, t.getAttributes());
            so.members.forEach(process);
        } else if (includeAny || t.kind !== "any") {
            members = members.add(t);
        } else {
            attributes = combineTypeAttributes(attributes, t.getAttributes());
        }
    }

    for (const so of setOperations) {
        process(so);
    }
    return [members, attributes];
}

export function makeGroupsToFlatten<T extends SetOperationType>(
    setOperations: Set<T>,
    include: ((members: Set<Type>) => boolean) | undefined
): Type[][] {
    let typeGroups = Map<Set<Type>, OrderedSet<Type>>();
    setOperations.forEach(u => {
        const members = setOperationMembersRecursively(u)[0].toSet();

        if (include !== undefined) {
            if (!include(members)) return;
        }

        let maybeSet = typeGroups.get(members);
        if (maybeSet === undefined) {
            maybeSet = OrderedSet();
            if (members.size === 1) {
                maybeSet = maybeSet.add(defined(members.first()));
            }
        }
        maybeSet = maybeSet.add(u);
        typeGroups = typeGroups.set(members, maybeSet);
    });

    return typeGroups
        .valueSeq()
        .toArray()
        .map(ts => ts.toArray());
}

export function combineTypeAttributesOfTypes(types: Type[]): TypeAttributes;
export function combineTypeAttributesOfTypes(types: Collection<any, Type>): TypeAttributes;
export function combineTypeAttributesOfTypes(types: Type[] | Collection<any, Type>): TypeAttributes {
    if (!Array.isArray(types)) {
        types = types.valueSeq().toArray();
    }
    return combineTypeAttributes(types.map(t => t.getAttributes()));
}

// FIXME: We shouldn't have to sort here.  This is just because we're not getting
// back the right order from JSON Schema, due to the changes the intersection types
// introduced.
export function removeNullFromUnion(
    t: UnionType,
    sortBy: boolean | ((t: Type) => any) = false
): [PrimitiveType | null, OrderedSet<Type>] {
    function sort(s: OrderedSet<Type>): OrderedSet<Type> {
        if (sortBy === false) return s;
        if (sortBy === true) return s.sortBy(m => m.kind);
        return s.sortBy(sortBy);
    }

    const nullType = t.findMember("null");
    if (nullType === undefined) {
        return [null, sort(t.members)];
    }
    return [nullType as PrimitiveType, sort(t.members.filterNot(m => m.kind === "null"))];
}

export function removeNullFromType(t: Type): [PrimitiveType | null, OrderedSet<Type>] {
    if (t.kind === "null") {
        return [t as PrimitiveType, OrderedSet()];
    }
    if (!(t instanceof UnionType)) {
        return [null, OrderedSet([t])];
    }
    return removeNullFromUnion(t);
}

export function nullableFromUnion(t: UnionType): Type | null {
    const [hasNull, nonNulls] = removeNullFromUnion(t);
    if (hasNull === null) return null;
    if (nonNulls.size !== 1) return null;
    return defined(nonNulls.first());
}

export function nonNullTypeCases(t: Type): OrderedSet<Type> {
    return removeNullFromType(t)[1];
}

export function getNullAsOptional(cp: ClassProperty): [boolean, OrderedSet<Type>] {
    const [maybeNull, nonNulls] = removeNullFromType(cp.type);
    if (cp.isOptional) {
        return [true, nonNulls];
    }
    return [maybeNull !== null, nonNulls];
}

// FIXME: Give this an appropriate name, considering that we don't distinguish
// between named and non-named types anymore.
export function isNamedType(t: Type): boolean {
    return ["class", "union", "enum", "object"].indexOf(t.kind) >= 0;
}

export type SeparatedNamedTypes = {
    objects: OrderedSet<ObjectType>;
    enums: OrderedSet<EnumType>;
    unions: OrderedSet<UnionType>;
};

export function separateNamedTypes(types: Collection<any, Type>): SeparatedNamedTypes {
    const objects = types.filter((t: Type) => t.kind === "object" || t.kind === "class").toOrderedSet() as OrderedSet<
        ObjectType
    >;
    const enums = types.filter((t: Type) => t instanceof EnumType).toOrderedSet() as OrderedSet<EnumType>;
    const unions = types.filter((t: Type) => t instanceof UnionType).toOrderedSet() as OrderedSet<UnionType>;

    return { objects, enums, unions };
}

export function directlyReachableSingleNamedType(type: Type): Type | undefined {
    const definedTypes = type.directlyReachableTypes(t => {
        if (
            (!(t instanceof UnionType) && isNamedType(t)) ||
            (t instanceof UnionType && nullableFromUnion(t) === null)
        ) {
            return OrderedSet([t]);
        }
        return null;
    });
    assert(definedTypes.size <= 1, "Cannot have more than one defined type per top-level");
    return definedTypes.first();
}

export function stringEnumCases(t: PrimitiveType): OrderedMap<string, number> | undefined {
    assert(t.kind === "string", "Only strings can be considered enums");
    const enumCases = stringEnumCasesTypeAttributeKind.tryGetInAttributes(t.getAttributes());
    if (enumCases === undefined) {
        return panic("All strings must have an enum case attribute");
    }
    if (enumCases === null) {
        return undefined;
    }
    return enumCases;
}

export type StringTypeMatchers<U> = {
    dateType?: (dateType: PrimitiveType) => U;
    timeType?: (timeType: PrimitiveType) => U;
    dateTimeType?: (dateTimeType: PrimitiveType) => U;
};

export function matchTypeExhaustive<U>(
    t: Type,
    noneType: (noneType: PrimitiveType) => U,
    anyType: (anyType: PrimitiveType) => U,
    nullType: (nullType: PrimitiveType) => U,
    boolType: (boolType: PrimitiveType) => U,
    integerType: (integerType: PrimitiveType) => U,
    doubleType: (doubleType: PrimitiveType) => U,
    stringType: (stringType: PrimitiveType) => U,
    arrayType: (arrayType: ArrayType) => U,
    classType: (classType: ClassType) => U,
    mapType: (mapType: MapType) => U,
    objectType: (objectType: ObjectType) => U,
    enumType: (enumType: EnumType) => U,
    unionType: (unionType: UnionType) => U,
    dateType: (dateType: PrimitiveType) => U,
    timeType: (timeType: PrimitiveType) => U,
    dateTimeType: (dateTimeType: PrimitiveType) => U
): U {
    if (t.isPrimitive()) {
        const f = {
            none: noneType,
            any: anyType,
            null: nullType,
            bool: boolType,
            integer: integerType,
            double: doubleType,
            string: stringType as (t: PrimitiveType) => U,
            date: dateType,
            time: timeType,
            "date-time": dateTimeType
        }[t.kind];
        if (f !== undefined) return f(t);
        return assertNever(f);
    } else if (t instanceof ArrayType) return arrayType(t);
    else if (t instanceof ClassType) return classType(t);
    else if (t instanceof MapType) return mapType(t);
    else if (t instanceof ObjectType) return objectType(t);
    else if (t instanceof EnumType) return enumType(t);
    else if (t instanceof UnionType) return unionType(t);
    return panic(`Unknown type ${t.kind}`);
}

export function matchType<U>(
    type: Type,
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
    unionType: (unionType: UnionType) => U,
    stringTypeMatchers?: StringTypeMatchers<U>
): U {
    function typeNotSupported(t: Type) {
        return panic(`Unsupported type ${t.kind} in non-exhaustive match`);
    }

    if (stringTypeMatchers === undefined) {
        stringTypeMatchers = {};
    }
    /* tslint:disable:strict-boolean-expressions */
    return matchTypeExhaustive(
        type,
        typeNotSupported,
        anyType,
        nullType,
        boolType,
        integerType,
        doubleType,
        stringType,
        arrayType,
        classType,
        mapType,
        typeNotSupported,
        enumType,
        unionType,
        stringTypeMatchers.dateType || typeNotSupported,
        stringTypeMatchers.timeType || typeNotSupported,
        stringTypeMatchers.dateTimeType || typeNotSupported
    );
    /* tslint:enable */
}

export function matchCompoundType(
    t: Type,
    arrayType: (arrayType: ArrayType) => void,
    classType: (classType: ClassType) => void,
    mapType: (mapType: MapType) => void,
    objectType: (objectType: ObjectType) => void,
    unionType: (unionType: UnionType) => void
): void {
    function ignore<T extends Type>(_: T): void {
        return;
    }

    return matchTypeExhaustive(
        t,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        ignore,
        arrayType,
        classType,
        mapType,
        objectType,
        ignore,
        unionType,
        ignore,
        ignore,
        ignore
    );
}

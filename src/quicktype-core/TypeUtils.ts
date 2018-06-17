import { setFilter, setSortBy, iterableFirst, setUnion, EqualityMap } from "collection-utils";

import { defined, panic, assert, assertNever } from "./support/Support";
import { TypeAttributes, combineTypeAttributes, emptyTypeAttributes, CombinationKind } from "./TypeAttributes";
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
    UnionType
} from "./Type";
import { stringTypesTypeAttributeKind, StringTypes } from "./StringTypes";

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
    setOperation: T,
    combinationKind: CombinationKind | undefined
): [ReadonlySet<Type>, TypeAttributes];
export function setOperationMembersRecursively<T extends SetOperationType>(
    setOperations: T[],
    combinationKind: CombinationKind | undefined
): [ReadonlySet<Type>, TypeAttributes];
export function setOperationMembersRecursively<T extends SetOperationType>(
    oneOrMany: T | T[],
    combinationKind: CombinationKind | undefined
): [ReadonlySet<Type>, TypeAttributes] {
    const setOperations = Array.isArray(oneOrMany) ? oneOrMany : [oneOrMany];
    const kind = setOperations[0].kind;
    const includeAny = kind !== "intersection";
    const processedSetOperations = new Set<T>();
    const members = new Set<Type>();
    let attributes = emptyTypeAttributes;

    function process(t: Type): void {
        if (t.kind === kind) {
            const so = t as T;
            if (processedSetOperations.has(so)) return;
            processedSetOperations.add(so);
            if (combinationKind !== undefined) {
                attributes = combineTypeAttributes(combinationKind, attributes, t.getAttributes());
            }
            for (const m of so.members) {
                process(m);
            }
        } else if (includeAny || t.kind !== "any") {
            members.add(t);
        } else {
            if (combinationKind !== undefined) {
                attributes = combineTypeAttributes(combinationKind, attributes, t.getAttributes());
            }
        }
    }

    for (const so of setOperations) {
        process(so);
    }
    return [members, attributes];
}

export function makeGroupsToFlatten<T extends SetOperationType>(
    setOperations: Iterable<T>,
    include: ((members: ReadonlySet<Type>) => boolean) | undefined
): Type[][] {
    const typeGroups = new EqualityMap<Set<Type>, Set<Type>>();
    for (const u of setOperations) {
        // FIXME: We shouldn't have to make a new set here once we got rid
        // of immutable.
        const members = new Set(setOperationMembersRecursively(u, undefined)[0]);

        if (include !== undefined) {
            if (!include(members)) continue;
        }

        let maybeSet = typeGroups.get(members);
        if (maybeSet === undefined) {
            maybeSet = new Set();
            if (members.size === 1) {
                maybeSet.add(defined(iterableFirst(members)));
            }
        }
        maybeSet.add(u);
        typeGroups.set(members, maybeSet);
    }

    return Array.from(typeGroups.values()).map(ts => Array.from(ts));
}

export function combineTypeAttributesOfTypes(combinationKind: CombinationKind, types: Iterable<Type>): TypeAttributes {
    return combineTypeAttributes(combinationKind, Array.from(types).map(t => t.getAttributes()));
}

// FIXME: We shouldn't have to sort here.  This is just because we're not getting
// back the right order from JSON Schema, due to the changes the intersection types
// introduced.
export function removeNullFromUnion(
    t: UnionType,
    sortBy: boolean | ((t: Type) => any) = false
): [PrimitiveType | null, ReadonlySet<Type>] {
    function sort(s: ReadonlySet<Type>): ReadonlySet<Type> {
        if (sortBy === false) return s;
        if (sortBy === true) return setSortBy(s, m => m.kind);
        return setSortBy(s, sortBy);
    }

    const nullType = t.findMember("null");
    if (nullType === undefined) {
        return [null, sort(t.members)];
    }
    return [nullType as PrimitiveType, sort(setFilter(t.members, m => m.kind !== "null"))];
}

export function removeNullFromType(t: Type): [PrimitiveType | null, ReadonlySet<Type>] {
    if (t.kind === "null") {
        return [t as PrimitiveType, new Set()];
    }
    if (!(t instanceof UnionType)) {
        return [null, new Set([t])];
    }
    return removeNullFromUnion(t);
}

export function nullableFromUnion(t: UnionType): Type | null {
    const [hasNull, nonNulls] = removeNullFromUnion(t);
    if (hasNull === null) return null;
    if (nonNulls.size !== 1) return null;
    return defined(iterableFirst(nonNulls));
}

export function nonNullTypeCases(t: Type): ReadonlySet<Type> {
    return removeNullFromType(t)[1];
}

export function getNullAsOptional(cp: ClassProperty): [boolean, ReadonlySet<Type>] {
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
    objects: ReadonlySet<ObjectType>;
    enums: ReadonlySet<EnumType>;
    unions: ReadonlySet<UnionType>;
};

export function separateNamedTypes(types: Iterable<Type>): SeparatedNamedTypes {
    const objects = (setFilter(types, t => t.kind === "object" || t.kind === "class") as Set<
        ObjectType
    >) as ReadonlySet<ObjectType>;
    const enums = (setFilter(types, t => t instanceof EnumType) as Set<EnumType>) as ReadonlySet<EnumType>;
    const unions = (setFilter(types, t => t instanceof UnionType) as Set<UnionType>) as ReadonlySet<UnionType>;

    return { objects, enums, unions };
}

function directlyReachableTypes<T>(t: Type, setForType: (t: Type) => ReadonlySet<T> | null): ReadonlySet<T> {
    const set = setForType(t);
    if (set !== null) return set;
    return setUnion(...Array.from(t.getNonAttributeChildren()).map(c => directlyReachableTypes(c, setForType)));
}

export function directlyReachableSingleNamedType(type: Type): Type | undefined {
    const definedTypes = directlyReachableTypes(type, t => {
        if (
            (!(t instanceof UnionType) && isNamedType(t)) ||
            (t instanceof UnionType && nullableFromUnion(t) === null)
        ) {
            return new Set([t]);
        }
        return null;
    });
    assert(definedTypes.size <= 1, "Cannot have more than one defined type per top-level");
    return iterableFirst(definedTypes);
}

export function stringTypesForType(t: PrimitiveType): StringTypes {
    assert(t.kind === "string", "Only strings can have string types");
    const stringTypes = stringTypesTypeAttributeKind.tryGetInAttributes(t.getAttributes());
    if (stringTypes === undefined) {
        return panic("All strings must have a string type attribute");
    }
    return stringTypes;
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
    dateTimeType: (dateTimeType: PrimitiveType) => U,
    integerStringType: (integerStringType: PrimitiveType) => U
): U {
    if (t.isPrimitive()) {
        const kind = t.kind;
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
            "date-time": dateTimeType,
            "integer-string": integerStringType
        }[kind];
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
        stringTypeMatchers.dateTimeType || typeNotSupported,
        typeNotSupported
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
        ignore,
        ignore
    );
}

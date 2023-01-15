import { TypeReconstituter, BaseGraphRewriteBuilder } from "./GraphRewriting";
import { TypeNames } from "./attributes/TypeNames";
import { TypeAttributes } from "./attributes/TypeAttributes";
import { TypeRef, TypeGraph } from "./TypeGraph";
import { uriInferenceAttributesProducer } from "./attributes/URIAttributes";
/**
 * `jsonSchema` is the `format` to be used to represent this string type in
 * JSON Schema.  It's ok to "invent" a new one if the JSON Schema standard doesn't
 * have that particular type yet.
 *
 * For transformed type kinds that map to an existing primitive type, `primitive`
 * must specify that type kind.
 */
export type TransformedStringTypeTargets = {
    jsonSchema: string;
    primitive: PrimitiveNonStringTypeKind | undefined;
    attributesProducer?: (s: string) => TypeAttributes;
};
/**
 * All the transformed string type kinds and the JSON Schema formats and
 * primitive type kinds they map to.  Not all transformed string types map to
 * primitive types.  Date-time types, for example, stand on their own, but
 * stringified integers map to integers.
 */
declare const transformedStringTypeTargetTypeKinds: {
    date: {
        jsonSchema: string;
        primitive: undefined;
    };
    time: {
        jsonSchema: string;
        primitive: undefined;
    };
    "date-time": {
        jsonSchema: string;
        primitive: undefined;
    };
    uuid: {
        jsonSchema: string;
        primitive: undefined;
    };
    uri: {
        jsonSchema: string;
        primitive: undefined;
        attributesProducer: typeof uriInferenceAttributesProducer;
    };
    "integer-string": TransformedStringTypeTargets;
    "bool-string": TransformedStringTypeTargets;
};
export declare const transformedStringTypeTargetTypeKindsMap: Map<string, TransformedStringTypeTargets>;
export type TransformedStringTypeKind = keyof typeof transformedStringTypeTargetTypeKinds;
export type PrimitiveStringTypeKind = "string" | TransformedStringTypeKind;
export type PrimitiveNonStringTypeKind = "none" | "any" | "null" | "bool" | "integer" | "double";
export type PrimitiveTypeKind = PrimitiveNonStringTypeKind | PrimitiveStringTypeKind;
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "object" | "map" | "intersection";
export type ObjectTypeKind = "object" | "map" | "class";
export declare const transformedStringTypeKinds: ReadonlySet<"date" | "time" | "date-time" | "uuid" | "uri" | "integer-string" | "bool-string">;
export declare function isPrimitiveStringTypeKind(kind: string): kind is PrimitiveStringTypeKind;
export declare function targetTypeKindForTransformedStringTypeKind(kind: PrimitiveStringTypeKind): PrimitiveNonStringTypeKind | undefined;
export declare function isNumberTypeKind(kind: TypeKind): kind is "integer" | "double";
export declare function isPrimitiveTypeKind(kind: TypeKind): kind is PrimitiveTypeKind;
export declare class TypeIdentity {
    private readonly _kind;
    private readonly _components;
    private readonly _hashCode;
    constructor(_kind: TypeKind, _components: ReadonlyArray<any>);
    equals(other: any): boolean;
    hashCode(): number;
}
export type MaybeTypeIdentity = TypeIdentity | undefined;
export declare abstract class Type {
    readonly typeRef: TypeRef;
    protected readonly graph: TypeGraph;
    abstract readonly kind: TypeKind;
    constructor(typeRef: TypeRef, graph: TypeGraph);
    get index(): number;
    abstract getNonAttributeChildren(): Set<Type>;
    getChildren(): ReadonlySet<Type>;
    getAttributes(): TypeAttributes;
    get hasNames(): boolean;
    getNames(): TypeNames;
    getCombinedName(): string;
    abstract get isNullable(): boolean;
    abstract isPrimitive(): this is PrimitiveType;
    abstract get identity(): MaybeTypeIdentity;
    abstract reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean): void;
    get debugPrintKind(): string;
    equals(other: any): boolean;
    hashCode(): number;
    protected abstract structuralEqualityStep(other: Type, conflateNumbers: boolean, queue: (a: Type, b: Type) => boolean): boolean;
    structurallyCompatible(other: Type, conflateNumbers?: boolean): boolean;
    getParentTypes(): ReadonlySet<Type>;
    getAncestorsNotInSet(set: ReadonlySet<TypeRef>): ReadonlySet<Type>;
}
export declare function primitiveTypeIdentity(kind: PrimitiveTypeKind, attributes: TypeAttributes): MaybeTypeIdentity;
export declare class PrimitiveType extends Type {
    readonly kind: PrimitiveTypeKind;
    constructor(typeRef: TypeRef, graph: TypeGraph, kind: PrimitiveTypeKind);
    get isNullable(): boolean;
    isPrimitive(): this is PrimitiveType;
    getNonAttributeChildren(): Set<Type>;
    get identity(): MaybeTypeIdentity;
    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void;
    protected structuralEqualityStep(_other: Type, _conflateNumbers: boolean, _queue: (a: Type, b: Type) => boolean): boolean;
}
export declare function arrayTypeIdentity(attributes: TypeAttributes, itemsRef: TypeRef): MaybeTypeIdentity;
export declare class ArrayType extends Type {
    private _itemsRef?;
    readonly kind = "array";
    constructor(typeRef: TypeRef, graph: TypeGraph, _itemsRef?: number | undefined);
    setItems(itemsRef: TypeRef): undefined;
    private getItemsRef;
    get items(): Type;
    getNonAttributeChildren(): Set<Type>;
    get isNullable(): boolean;
    isPrimitive(): this is PrimitiveType;
    get identity(): MaybeTypeIdentity;
    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void;
    protected structuralEqualityStep(other: ArrayType, _conflateNumbers: boolean, queue: (a: Type, b: Type) => boolean): boolean;
}
export declare class GenericClassProperty<T> {
    readonly typeData: T;
    readonly isOptional: boolean;
    constructor(typeData: T, isOptional: boolean);
    equals(other: any): boolean;
    hashCode(): number;
}
export declare class ClassProperty extends GenericClassProperty<TypeRef> {
    readonly graph: TypeGraph;
    constructor(typeRef: TypeRef, graph: TypeGraph, isOptional: boolean);
    get typeRef(): TypeRef;
    get type(): Type;
}
export declare function classTypeIdentity(attributes: TypeAttributes, properties: ReadonlyMap<string, ClassProperty>): MaybeTypeIdentity;
export declare function mapTypeIdentify(attributes: TypeAttributes, additionalPropertiesRef: TypeRef | undefined): MaybeTypeIdentity;
export declare class ObjectType extends Type {
    readonly kind: ObjectTypeKind;
    readonly isFixed: boolean;
    private _properties;
    private _additionalPropertiesRef;
    constructor(typeRef: TypeRef, graph: TypeGraph, kind: ObjectTypeKind, isFixed: boolean, _properties: ReadonlyMap<string, ClassProperty> | undefined, _additionalPropertiesRef: TypeRef | undefined);
    setProperties(properties: ReadonlyMap<string, ClassProperty>, additionalPropertiesRef: TypeRef | undefined): void;
    getProperties(): ReadonlyMap<string, ClassProperty>;
    getSortedProperties(): ReadonlyMap<string, ClassProperty>;
    private getAdditionalPropertiesRef;
    getAdditionalProperties(): Type | undefined;
    getNonAttributeChildren(): Set<Type>;
    get isNullable(): boolean;
    isPrimitive(): this is PrimitiveType;
    get identity(): MaybeTypeIdentity;
    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean): void;
    protected structuralEqualityStep(other: ObjectType, _conflateNumbers: boolean, queue: (a: Type, b: Type) => boolean): boolean;
}
export declare class ClassType extends ObjectType {
    constructor(typeRef: TypeRef, graph: TypeGraph, isFixed: boolean, properties: ReadonlyMap<string, ClassProperty> | undefined);
}
export declare class MapType extends ObjectType {
    constructor(typeRef: TypeRef, graph: TypeGraph, valuesRef: TypeRef | undefined);
    get values(): Type;
}
export declare function enumTypeIdentity(attributes: TypeAttributes, cases: ReadonlySet<string>): MaybeTypeIdentity;
export declare class EnumType extends Type {
    readonly cases: ReadonlySet<string>;
    readonly kind = "enum";
    constructor(typeRef: TypeRef, graph: TypeGraph, cases: ReadonlySet<string>);
    get isNullable(): boolean;
    isPrimitive(): this is PrimitiveType;
    get identity(): MaybeTypeIdentity;
    getNonAttributeChildren(): Set<Type>;
    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>): void;
    protected structuralEqualityStep(other: EnumType, _conflateNumbers: boolean, _queue: (a: Type, b: Type) => void): boolean;
}
export declare function setOperationCasesEqual(typesA: Iterable<Type>, typesB: Iterable<Type>, conflateNumbers: boolean, membersEqual: (a: Type, b: Type) => boolean): boolean;
export declare function setOperationTypeIdentity(kind: TypeKind, attributes: TypeAttributes, memberRefs: ReadonlySet<TypeRef>): MaybeTypeIdentity;
export declare function unionTypeIdentity(attributes: TypeAttributes, memberRefs: ReadonlySet<TypeRef>): MaybeTypeIdentity;
export declare function intersectionTypeIdentity(attributes: TypeAttributes, memberRefs: ReadonlySet<TypeRef>): MaybeTypeIdentity;
export declare abstract class SetOperationType extends Type {
    readonly kind: TypeKind;
    private _memberRefs?;
    constructor(typeRef: TypeRef, graph: TypeGraph, kind: TypeKind, _memberRefs?: ReadonlySet<number> | undefined);
    setMembers(memberRefs: ReadonlySet<TypeRef>): void;
    protected getMemberRefs(): ReadonlySet<TypeRef>;
    get members(): ReadonlySet<Type>;
    get sortedMembers(): ReadonlySet<Type>;
    getNonAttributeChildren(): Set<Type>;
    isPrimitive(): this is PrimitiveType;
    get identity(): MaybeTypeIdentity;
    protected reconstituteSetOperation<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean, getType: (members: ReadonlySet<TypeRef> | undefined) => void): void;
    protected structuralEqualityStep(other: SetOperationType, conflateNumbers: boolean, queue: (a: Type, b: Type) => boolean): boolean;
}
export declare class IntersectionType extends SetOperationType {
    constructor(typeRef: TypeRef, graph: TypeGraph, memberRefs?: ReadonlySet<TypeRef>);
    get isNullable(): boolean;
    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean): void;
}
export declare class UnionType extends SetOperationType {
    constructor(typeRef: TypeRef, graph: TypeGraph, memberRefs?: ReadonlySet<TypeRef>);
    setMembers(memberRefs: ReadonlySet<TypeRef>): void;
    get stringTypeMembers(): ReadonlySet<Type>;
    findMember(kind: TypeKind): Type | undefined;
    get isNullable(): boolean;
    get isCanonical(): boolean;
    reconstitute<T extends BaseGraphRewriteBuilder>(builder: TypeReconstituter<T>, canonicalOrder: boolean): void;
}
export {};

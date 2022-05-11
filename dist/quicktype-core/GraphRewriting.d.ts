import { PrimitiveTypeKind, Type, ClassProperty, MaybeTypeIdentity } from "./Type";
import { TypeGraph, TypeRef } from "./TypeGraph";
import { TypeAttributes } from "./attributes/TypeAttributes";
import { TypeBuilder, StringTypeMapping } from "./TypeBuilder";
export interface TypeLookerUp {
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef): TypeRef | undefined;
    reconstituteTypeRef(typeRef: TypeRef, attributes?: TypeAttributes, forwardingRef?: TypeRef): TypeRef;
}
export declare class TypeReconstituter<TBuilder extends BaseGraphRewriteBuilder> {
    private readonly _typeBuilder;
    private readonly _makeClassUnique;
    private readonly _typeAttributes;
    private readonly _forwardingRef;
    private readonly _register;
    private _wasUsed;
    private _typeRef;
    constructor(_typeBuilder: TBuilder, _makeClassUnique: boolean, _typeAttributes: TypeAttributes, _forwardingRef: TypeRef | undefined, _register: (tref: TypeRef) => void);
    private builderForNewType;
    private builderForSetting;
    getResult(): TypeRef;
    private register;
    private registerAndAddAttributes;
    lookup(tref: TypeRef): TypeRef | undefined;
    lookup(trefs: Iterable<TypeRef>): ReadonlyArray<TypeRef> | undefined;
    lookupMap<K>(trefs: ReadonlyMap<K, TypeRef>): ReadonlyMap<K, TypeRef> | undefined;
    reconstitute(tref: TypeRef): TypeRef;
    reconstitute(trefs: Iterable<TypeRef>): ReadonlyArray<TypeRef>;
    reconstituteMap<K>(trefs: ReadonlyMap<K, TypeRef>): ReadonlyMap<K, TypeRef>;
    getPrimitiveType(kind: PrimitiveTypeKind): void;
    getEnumType(cases: ReadonlySet<string>): void;
    getUniqueMapType(): void;
    getMapType(values: TypeRef): void;
    getUniqueArrayType(): void;
    getArrayType(items: TypeRef): void;
    setArrayItems(items: TypeRef): void;
    makeClassProperty(tref: TypeRef, isOptional: boolean): ClassProperty;
    getObjectType(properties: ReadonlyMap<string, ClassProperty>, additionalProperties: TypeRef | undefined): void;
    getUniqueObjectType(properties: ReadonlyMap<string, ClassProperty> | undefined, additionalProperties: TypeRef | undefined): void;
    getClassType(properties: ReadonlyMap<string, ClassProperty>): void;
    getUniqueClassType(isFixed: boolean, properties: ReadonlyMap<string, ClassProperty> | undefined): void;
    setObjectProperties(properties: ReadonlyMap<string, ClassProperty>, additionalProperties: TypeRef | undefined): void;
    getUnionType(members: ReadonlySet<TypeRef>): void;
    getUniqueUnionType(): void;
    getIntersectionType(members: ReadonlySet<TypeRef>): void;
    getUniqueIntersectionType(members?: ReadonlySet<TypeRef>): void;
    setSetOperationMembers(members: ReadonlySet<TypeRef>): void;
}
export declare abstract class BaseGraphRewriteBuilder extends TypeBuilder implements TypeLookerUp {
    readonly originalGraph: TypeGraph;
    protected readonly debugPrint: boolean;
    protected readonly reconstitutedTypes: Map<number, TypeRef>;
    private _lostTypeAttributes;
    private _printIndent;
    constructor(originalGraph: TypeGraph, stringTypeMapping: StringTypeMapping, alphabetizeProperties: boolean, graphHasProvenanceAttributes: boolean, debugPrint: boolean);
    withForwardingRef(maybeForwardingRef: TypeRef | undefined, typeCreator: (forwardingRef: TypeRef) => TypeRef): TypeRef;
    reconstituteType(t: Type, attributes?: TypeAttributes, forwardingRef?: TypeRef): TypeRef;
    abstract lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef, replaceSet?: boolean): TypeRef | undefined;
    protected abstract forceReconstituteTypeRef(originalRef: TypeRef, attributes?: TypeAttributes, maybeForwardingRef?: TypeRef): TypeRef;
    reconstituteTypeRef(originalRef: TypeRef, attributes?: TypeAttributes, maybeForwardingRef?: TypeRef): TypeRef;
    reconstituteTypeAttributes(attributes: TypeAttributes): TypeAttributes;
    protected assertTypeRefsToReconstitute(typeRefs: TypeRef[], forwardingRef?: TypeRef): void;
    protected changeDebugPrintIndent(delta: number): void;
    protected readonly debugPrintIndentation: string;
    finish(): TypeGraph;
    setLostTypeAttributes(): void;
    readonly lostTypeAttributes: boolean;
}
export declare class GraphRemapBuilder extends BaseGraphRewriteBuilder {
    private readonly _map;
    private readonly _attributeSources;
    constructor(originalGraph: TypeGraph, stringTypeMapping: StringTypeMapping, alphabetizeProperties: boolean, graphHasProvenanceAttributes: boolean, _map: ReadonlyMap<Type, Type>, debugPrintRemapping: boolean);
    protected makeIdentity(_maker: () => MaybeTypeIdentity): MaybeTypeIdentity;
    private getMapTarget;
    protected addForwardingIntersection(_forwardingRef: TypeRef, _tref: TypeRef): TypeRef;
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef): TypeRef | undefined;
    protected forceReconstituteTypeRef(originalRef: TypeRef, attributes?: TypeAttributes, maybeForwardingRef?: TypeRef): TypeRef;
}
export declare class GraphRewriteBuilder<T extends Type> extends BaseGraphRewriteBuilder {
    private readonly _replacer;
    private readonly _setsToReplaceByMember;
    private readonly _reconstitutedUnions;
    constructor(originalGraph: TypeGraph, stringTypeMapping: StringTypeMapping, alphabetizeProperties: boolean, graphHasProvenanceAttributes: boolean, setsToReplace: T[][], debugPrintReconstitution: boolean, _replacer: (typesToReplace: ReadonlySet<T>, builder: GraphRewriteBuilder<T>, forwardingRef: TypeRef) => TypeRef);
    registerUnion(typeRefs: TypeRef[], reconstituted: TypeRef): void;
    private replaceSet;
    protected forceReconstituteTypeRef(originalRef: TypeRef, attributes?: TypeAttributes, maybeForwardingRef?: TypeRef): TypeRef;
    lookupTypeRefs(typeRefs: TypeRef[], forwardingRef?: TypeRef, replaceSet?: boolean): TypeRef | undefined;
}

import { Type, ClassType, EnumType, UnionType, TypeKind, ClassProperty, ObjectType } from "./Type";
import { Namespace, Name, Namer, DependencyName } from "./Naming";
import { Renderer, BlankLineConfig, RenderContext, ForEachPosition } from "./Renderer";
import { Sourcelike } from "./Source";
import { Declaration } from "./DeclarationIR";
import { Transformation } from "./Transformers";
import { TargetLanguage } from "./TargetLanguage";
export declare const topLevelNameOrder = 1;
export declare const inferredNameOrder = 30;
export declare type ForbiddenWordsInfo = {
    names: (Name | string)[];
    includeGlobalForbidden: boolean;
};
export declare abstract class ConvenienceRenderer extends Renderer {
    private _globalForbiddenNamespace;
    private _otherForbiddenNamespaces;
    private _globalNamespace;
    private _nameStoreView;
    private _propertyNamesStoreView;
    private _memberNamesStoreView;
    private _caseNamesStoreView;
    private _namesForTransformations;
    private _namedTypeNamer;
    private _unionMemberNamer;
    private _enumCaseNamer;
    private _declarationIR;
    private _namedTypes;
    private _namedObjects;
    private _namedEnums;
    private _namedUnions;
    private _haveUnions;
    private _haveMaps;
    private _haveOptionalProperties;
    private _cycleBreakerTypes?;
    private _alphabetizeProperties;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext);
    readonly topLevels: ReadonlyMap<string, Type>;
    /**
     * Return an array of strings which are not allowed as names in the global
     * namespace.  Since names of generated types are in the global namespace,
     * this will include anything built into the language or default libraries
     * that can conflict with that, such as reserved keywords or common type
     * names.
     */
    protected forbiddenNamesForGlobalNamespace(): string[];
    /**
     * Returns which names are forbidden for the property names of an object
     * type.  `names` can contain strings as well as `Name`s.  In some
     * languages, the class name can't be used as the name for a property, for
     * example, in which case `_className` would have to be return in `names`.
     * If `includeGlobalForbidden` is set, then all names that are forbidden
     * in the global namespace will also be forbidden for the properties.
     * Note: That doesn't mean that the names in the global namespace will be
     * forbidden, too!
     */
    protected forbiddenForObjectProperties(_o: ObjectType, _className: Name): ForbiddenWordsInfo;
    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo;
    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo;
    protected makeTopLevelDependencyNames(_t: Type, _topLevelName: Name): DependencyName[];
    protected makeNamedTypeDependencyNames(_t: Type, _name: Name): DependencyName[];
    protected abstract makeNamedTypeNamer(): Namer;
    protected abstract namerForObjectProperty(o: ObjectType, p: ClassProperty): Namer | null;
    protected abstract makeUnionMemberNamer(): Namer | null;
    protected abstract makeEnumCaseNamer(): Namer | null;
    protected abstract emitSourceStructure(givenOutputFilename: string): void;
    protected makeNameForTransformation(_xf: Transformation, _typeName: Name | undefined): Name | undefined;
    protected namedTypeToNameForTopLevel(type: Type): Type | undefined;
    protected readonly unionMembersInGlobalNamespace: boolean;
    protected readonly enumCasesInGlobalNamespace: boolean;
    protected readonly needsTypeDeclarationBeforeUse: boolean;
    protected canBeForwardDeclared(_t: Type): boolean;
    protected unionNeedsName(u: UnionType): boolean;
    private readonly globalNamespace;
    private readonly nameStoreView;
    protected descriptionForType(t: Type): string[] | undefined;
    protected descriptionForClassProperty(o: ObjectType, name: string): string[] | undefined;
    protected setUpNaming(): ReadonlySet<Namespace>;
    private addDependenciesForNamedType;
    protected makeNameForTopLevel(_t: Type, givenName: string, _maybeNamedType: Type | undefined): Name;
    private addNameForTopLevel;
    private makeNameForType;
    protected makeNameForNamedType(t: Type): Name;
    private addNameForNamedType;
    protected readonly typesWithNamedTransformations: ReadonlyMap<Type, Name>;
    protected nameForTransformation(t: Type): Name | undefined;
    private addNameForTransformation;
    private processForbiddenWordsInfo;
    protected makeNameForProperty(o: ObjectType, _className: Name, p: ClassProperty, jsonName: string, assignedName: string | undefined): Name | undefined;
    protected makePropertyDependencyNames(_o: ObjectType, _className: Name, _p: ClassProperty, _jsonName: string, _name: Name): Name[];
    private addPropertyNames;
    protected makeNameForUnionMember(u: UnionType, unionName: Name, t: Type): Name;
    private addUnionMemberNames;
    protected makeNameForEnumCase(e: EnumType, _enumName: Name, caseName: string, assignedName: string | undefined): Name;
    private addEnumCaseNames;
    private childrenOfType;
    protected readonly namedUnions: ReadonlySet<UnionType>;
    protected readonly haveNamedUnions: boolean;
    protected readonly haveNamedTypes: boolean;
    protected readonly haveUnions: boolean;
    protected readonly haveMaps: boolean;
    protected readonly haveOptionalProperties: boolean;
    protected readonly enums: ReadonlySet<EnumType>;
    protected readonly haveEnums: boolean;
    protected proposedUnionMemberNameForTypeKind(_kind: TypeKind): string | null;
    protected proposeUnionMemberName(_u: UnionType, _unionName: Name, fieldType: Type, lookup: (n: Name) => string): string;
    protected nameForNamedType(t: Type): Name;
    protected isForwardDeclaredType(t: Type): boolean;
    protected isImplicitCycleBreaker(_t: Type): boolean;
    protected canBreakCycles(_t: Type): boolean;
    protected isCycleBreakerType(t: Type): boolean;
    protected forEachTopLevel(blankLocations: BlankLineConfig, f: (t: Type, name: Name, position: ForEachPosition) => void, predicate?: (t: Type) => boolean): boolean;
    protected forEachDeclaration(blankLocations: BlankLineConfig, f: (decl: Declaration, position: ForEachPosition) => void): void;
    setAlphabetizeProperties(value: boolean): void;
    protected getAlphabetizeProperties(): boolean;
    protected propertyCount(o: ObjectType): number;
    protected sortClassProperties(properties: ReadonlyMap<string, ClassProperty>, propertyNames: ReadonlyMap<string, Name>): ReadonlyMap<string, ClassProperty>;
    protected forEachClassProperty(o: ObjectType, blankLocations: BlankLineConfig, f: (name: Name, jsonName: string, p: ClassProperty, position: ForEachPosition) => void): void;
    protected nameForUnionMember(u: UnionType, t: Type): Name;
    protected nameForEnumCase(e: EnumType, caseName: string): Name;
    protected forEachUnionMember(u: UnionType, members: ReadonlySet<Type> | null, blankLocations: BlankLineConfig, sortOrder: ((n: Name, t: Type) => string) | null, f: (name: Name, t: Type, position: ForEachPosition) => void): void;
    protected forEachEnumCase(e: EnumType, blankLocations: BlankLineConfig, f: (name: Name, jsonName: string, position: ForEachPosition) => void): void;
    protected forEachTransformation(blankLocations: BlankLineConfig, f: (n: Name, t: Type, position: ForEachPosition) => void): void;
    protected forEachSpecificNamedType<T extends Type>(blankLocations: BlankLineConfig, types: Iterable<[any, T]>, f: (t: T, name: Name, position: ForEachPosition) => void): void;
    protected forEachObject(blankLocations: BlankLineConfig, f: ((c: ClassType, className: Name, position: ForEachPosition) => void) | ((o: ObjectType, objectName: Name, position: ForEachPosition) => void)): void;
    protected forEachEnum(blankLocations: BlankLineConfig, f: (u: EnumType, enumName: Name, position: ForEachPosition) => void): void;
    protected forEachUnion(blankLocations: BlankLineConfig, f: (u: UnionType, unionName: Name, position: ForEachPosition) => void): void;
    protected forEachUniqueUnion<T>(blankLocations: BlankLineConfig, uniqueValue: (u: UnionType) => T, f: (firstUnion: UnionType, value: T, position: ForEachPosition) => void): void;
    protected forEachNamedType(blankLocations: BlankLineConfig, objectFunc: ((c: ClassType, className: Name, position: ForEachPosition) => void) | ((o: ObjectType, objectName: Name, position: ForEachPosition) => void), enumFunc: (e: EnumType, enumName: Name, position: ForEachPosition) => void, unionFunc: (u: UnionType, unionName: Name, position: ForEachPosition) => void): void;
    protected sourcelikeToString(src: Sourcelike): string;
    protected readonly commentLineStart: string;
    protected emitCommentLines(lines: Sourcelike[], lineStart?: string, beforeLine?: string, afterLine?: string, firstLineStart?: string): void;
    protected emitDescription(description: Sourcelike[] | undefined): void;
    protected emitDescriptionBlock(lines: Sourcelike[]): void;
    protected emitPropertyTable(c: ClassType, makePropertyRow: (name: Name, jsonName: string, p: ClassProperty) => Sourcelike[]): void;
    private processGraph;
    protected emitSource(givenOutputFilename: string): void;
    protected forEachType<TResult>(process: (t: Type) => TResult): Set<TResult>;
}

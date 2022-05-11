import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Name, Namer } from "../Naming";
import { EnumOption, Option, StringOption, OptionValues } from "../RendererOptions";
import { Sourcelike } from "../Source";
import { TargetLanguage } from "../TargetLanguage";
import { ArrayType, ClassType, EnumType, MapType, ObjectType, PrimitiveType, Type, UnionType } from "../Type";
import { RenderContext } from "../Renderer";
export declare enum Framework {
    None = 0,
    Jackson = 1,
    Klaxon = 2,
    KotlinX = 3
}
export declare const kotlinOptions: {
    framework: EnumOption<Framework>;
    packageName: StringOption;
};
export declare class KotlinTargetLanguage extends TargetLanguage {
    constructor();
    protected getOptions(): Option<any>[];
    readonly supportsOptionalClassProperties: boolean;
    readonly supportsUnionsWithBothNumberTypes: boolean;
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): ConvenienceRenderer;
}
export declare class KotlinRenderer extends ConvenienceRenderer {
    protected readonly _kotlinOptions: OptionValues<typeof kotlinOptions>;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _kotlinOptions: OptionValues<typeof kotlinOptions>);
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected forbiddenForObjectProperties(_o: ObjectType, _classNamed: Name): ForbiddenWordsInfo;
    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo;
    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo;
    protected topLevelNameStyle(rawName: string): string;
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected makeUnionMemberNamer(): Namer;
    protected makeEnumCaseNamer(): Namer;
    protected emitDescriptionBlock(lines: Sourcelike[]): void;
    protected emitBlock(line: Sourcelike, f: () => void, delimiter?: "curly" | "paren" | "lambda"): void;
    protected anySourceType(optional: string): Sourcelike;
    protected arrayType(arrayType: ArrayType, withIssues?: boolean, _noOptional?: boolean): Sourcelike;
    protected mapType(mapType: MapType, withIssues?: boolean, _noOptional?: boolean): Sourcelike;
    protected kotlinType(t: Type, withIssues?: boolean, noOptional?: boolean): Sourcelike;
    protected emitUsageHeader(): void;
    protected emitHeader(): void;
    protected emitTopLevelArray(t: ArrayType, name: Name): void;
    protected emitTopLevelMap(t: MapType, name: Name): void;
    protected emitEmptyClassDefinition(c: ClassType, className: Name): void;
    protected emitClassDefinition(c: ClassType, className: Name): void;
    protected emitClassDefinitionMethods(_c: ClassType, _className: Name): void;
    protected emitClassAnnotations(_c: Type, _className: Name): void;
    protected renameAttribute(_name: Name, _jsonName: string, _required: boolean, _meta: Array<() => void>): void;
    protected emitEnumDefinition(e: EnumType, enumName: Name): void;
    protected emitUnionDefinition(u: UnionType, unionName: Name): void;
    protected emitUnionDefinitionMethods(_u: UnionType, _nonNulls: ReadonlySet<Type>, _maybeNull: PrimitiveType | null, _unionName: Name): void;
    protected emitSourceStructure(): void;
}
export declare class KotlinKlaxonRenderer extends KotlinRenderer {
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _kotlinOptions: OptionValues<typeof kotlinOptions>);
    private unionMemberFromJsonValue;
    private unionMemberJsonValueGuard;
    protected emitUsageHeader(): void;
    protected emitHeader(): void;
    protected emitTopLevelArray(t: ArrayType, name: Name): void;
    protected emitTopLevelMap(t: MapType, name: Name): void;
    private klaxonRenameAttribute;
    protected emitEmptyClassDefinition(c: ClassType, className: Name): void;
    protected emitClassDefinitionMethods(c: ClassType, className: Name): void;
    protected renameAttribute(name: Name, jsonName: string, _required: boolean, meta: Array<() => void>): void;
    protected emitEnumDefinition(e: EnumType, enumName: Name): void;
    private emitGenericConverter;
    protected emitUnionDefinitionMethods(u: UnionType, nonNulls: ReadonlySet<Type>, maybeNull: PrimitiveType | null, unionName: Name): void;
}
export declare class KotlinJacksonRenderer extends KotlinRenderer {
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _kotlinOptions: OptionValues<typeof kotlinOptions>);
    private unionMemberJsonValueGuard;
    protected emitUsageHeader(): void;
    protected emitHeader(): void;
    protected emitTopLevelArray(t: ArrayType, name: Name): void;
    protected emitTopLevelMap(t: MapType, name: Name): void;
    private jacksonRenameAttribute;
    protected emitEmptyClassDefinition(c: ClassType, className: Name): void;
    protected emitClassDefinitionMethods(c: ClassType, className: Name): void;
    protected renameAttribute(name: Name, jsonName: string, required: boolean, meta: Array<() => void>): void;
    protected emitEnumDefinition(e: EnumType, enumName: Name): void;
    private emitGenericConverter;
    protected emitUnionDefinitionMethods(u: UnionType, nonNulls: ReadonlySet<Type>, maybeNull: PrimitiveType | null, unionName: Name): void;
}
/**
 * Currently supports simple classes, enums, and TS string unions (which are also enums).
 * TODO: Union, Any, Top Level Array, Top Level Map
 */
export declare class KotlinXRenderer extends KotlinRenderer {
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _kotlinOptions: OptionValues<typeof kotlinOptions>);
    protected anySourceType(optional: string): Sourcelike;
    protected arrayType(arrayType: ArrayType, withIssues?: boolean, noOptional?: boolean): Sourcelike;
    protected mapType(mapType: MapType, withIssues?: boolean, noOptional?: boolean): Sourcelike;
    protected emitTopLevelMap(t: MapType, name: Name): void;
    protected emitTopLevelArray(t: ArrayType, name: Name): void;
    protected emitUsageHeader(): void;
    protected emitHeader(): void;
    protected emitClassAnnotations(_c: Type, _className: Name): void;
    protected renameAttribute(name: Name, jsonName: string, _required: boolean, meta: Array<() => void>): void;
    private _rename;
    protected emitEnumDefinition(e: EnumType, enumName: Name): void;
}

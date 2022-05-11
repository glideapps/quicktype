import { Type, UnionType, ClassType, ClassProperty } from "../Type";
import { Sourcelike } from "../Source";
import { Name, DependencyName, Namer } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { StringOption, EnumOption, Option, BooleanOption, OptionValues } from "../RendererOptions";
import { StringTypeMapping } from "../TypeBuilder";
import { Transformation } from "../Transformers";
import { RenderContext } from "../Renderer";
export declare type Version = 5 | 6;
export declare type OutputFeatures = {
    helpers: boolean;
    attributes: boolean;
};
export declare enum AccessModifier {
    None = 0,
    Public = 1,
    Internal = 2
}
export declare type CSharpTypeForAny = "object" | "dynamic";
export declare const cSharpOptions: {
    useList: EnumOption<boolean>;
    dense: EnumOption<boolean>;
    namespace: StringOption;
    version: EnumOption<Version>;
    virtual: BooleanOption;
    typeForAny: EnumOption<CSharpTypeForAny>;
    useDecimal: EnumOption<boolean>;
};
export declare class CSharpTargetLanguage extends TargetLanguage {
    protected getOptions(): Option<any>[];
    readonly stringTypeMapping: StringTypeMapping;
    readonly supportsUnionsWithBothNumberTypes: boolean;
    readonly supportsOptionalClassProperties: boolean;
    needsTransformerForType(t: Type): boolean;
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): CSharpRenderer;
}
export declare class CSharpRenderer extends ConvenienceRenderer {
    private readonly _csOptions;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _csOptions: OptionValues<typeof cSharpOptions>);
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected forbiddenForObjectProperties(_: ClassType, classNamed: Name): ForbiddenWordsInfo;
    protected forbiddenForUnionMembers(_: UnionType, unionNamed: Name): ForbiddenWordsInfo;
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected makeUnionMemberNamer(): Namer;
    protected makeEnumCaseNamer(): Namer;
    protected unionNeedsName(u: UnionType): boolean;
    protected namedTypeToNameForTopLevel(type: Type): Type | undefined;
    protected emitBlock(f: () => void, semicolon?: boolean): void;
    protected readonly doubleType: string;
    protected csType(t: Type, follow?: (t: Type) => Type, withIssues?: boolean): Sourcelike;
    protected nullableCSType(t: Type, follow?: (t: Type) => Type, withIssues?: boolean): Sourcelike;
    protected baseclassForType(_t: Type): Sourcelike | undefined;
    protected emitType(description: string[] | undefined, accessModifier: AccessModifier, declaration: Sourcelike, name: Sourcelike, baseclass: Sourcelike | undefined, emitter: () => void): void;
    protected attributesForProperty(_property: ClassProperty, _name: Name, _c: ClassType, _jsonName: string): Sourcelike[] | undefined;
    protected propertyDefinition(property: ClassProperty, name: Name, _c: ClassType, _jsonName: string): Sourcelike;
    protected emitDescriptionBlock(lines: Sourcelike[]): void;
    protected blankLinesBetweenAttributes(): boolean;
    private emitClassDefinition;
    private emitUnionDefinition;
    private emitEnumDefinition;
    protected emitExpressionMember(declare: Sourcelike, define: Sourcelike, isProperty?: boolean): void;
    protected emitTypeSwitch<T extends Sourcelike>(types: Iterable<T>, condition: (t: T) => Sourcelike, withBlock: boolean, withReturn: boolean, f: (t: T) => void): void;
    protected emitUsing(ns: Sourcelike): void;
    protected emitUsings(): void;
    protected emitRequiredHelpers(): void;
    private emitTypesAndSupport;
    protected emitDefaultLeadingComments(): void;
    protected needNamespace(): boolean;
    protected emitSourceStructure(): void;
}
export declare const newtonsoftCSharpOptions: {
    useList: EnumOption<boolean>;
    dense: EnumOption<boolean>;
    namespace: StringOption;
    version: EnumOption<Version>;
    virtual: BooleanOption;
    typeForAny: EnumOption<CSharpTypeForAny>;
    useDecimal: EnumOption<boolean>;
} & {
    features: EnumOption<{
        namespaces: boolean;
        helpers: boolean;
        attributes: boolean;
    }>;
    baseclass: EnumOption<string | undefined>;
    checkRequired: BooleanOption;
};
export declare class NewtonsoftCSharpTargetLanguage extends CSharpTargetLanguage {
    constructor();
    protected getOptions(): Option<any>[];
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): NewtonsoftCSharpRenderer;
}
export declare class NewtonsoftCSharpRenderer extends CSharpRenderer {
    private readonly _options;
    private readonly _enumExtensionsNames;
    private readonly _needHelpers;
    private readonly _needAttributes;
    private readonly _needNamespaces;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _options: OptionValues<typeof newtonsoftCSharpOptions>);
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected forbiddenForObjectProperties(c: ClassType, className: Name): ForbiddenWordsInfo;
    protected makeNameForTransformation(xf: Transformation, typeName: Name | undefined): Name;
    protected makeNamedTypeDependencyNames(t: Type, name: Name): DependencyName[];
    protected emitUsings(): void;
    protected baseclassForType(_t: Type): Sourcelike | undefined;
    protected emitDefaultLeadingComments(): void;
    private converterForType;
    protected attributesForProperty(property: ClassProperty, _name: Name, _c: ClassType, jsonName: string): Sourcelike[] | undefined;
    protected blankLinesBetweenAttributes(): boolean;
    private topLevelResultType;
    private emitFromJsonForTopLevel;
    private emitDecoderSwitch;
    private emitTokenCase;
    private emitThrow;
    private deserializeTypeCode;
    private serializeValueCode;
    private emitSerializeClass;
    private emitCanConvert;
    private emitReadJson;
    private emitWriteJson;
    private converterObject;
    private emitConverterClass;
    private emitDecoderTransformerCase;
    private emitConsume;
    private emitDecodeTransformer;
    private stringCaseValue;
    private emitTransformer;
    private emitTransformation;
    protected emitRequiredHelpers(): void;
    protected needNamespace(): boolean;
}

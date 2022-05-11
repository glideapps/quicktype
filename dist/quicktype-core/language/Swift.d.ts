import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, UnionType, TypeKind, ClassProperty } from "../Type";
import { Name, Namer } from "../Naming";
import { BooleanOption, EnumOption, Option, StringOption, OptionValues } from "../RendererOptions";
import { Sourcelike } from "../Source";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { RenderContext, ForEachPosition } from "../Renderer";
import { StringTypeMapping } from "../TypeBuilder";
import { DateTimeRecognizer } from "../DateTime";
import { AcronymStyleOptions } from "../support/Acronyms";
export declare const swiftOptions: {
    justTypes: BooleanOption;
    convenienceInitializers: BooleanOption;
    explicitCodingKeys: BooleanOption;
    urlSession: BooleanOption;
    alamofire: BooleanOption;
    namedTypePrefix: StringOption;
    useClasses: EnumOption<boolean>;
    mutableProperties: BooleanOption;
    acronymStyle: EnumOption<AcronymStyleOptions>;
    dense: EnumOption<boolean>;
    linux: BooleanOption;
    objcSupport: BooleanOption;
    swift5Support: BooleanOption;
    multiFileOutput: BooleanOption;
    accessLevel: EnumOption<string>;
    protocol: EnumOption<{
        equatable: boolean;
        hashable: boolean;
    }>;
};
export interface SwiftProperty {
    name: Name;
    jsonName: string;
    parameter: ClassProperty;
    position: ForEachPosition;
}
export declare class SwiftTargetLanguage extends TargetLanguage {
    constructor();
    protected getOptions(): Option<any>[];
    readonly stringTypeMapping: StringTypeMapping;
    readonly supportsOptionalClassProperties: boolean;
    readonly supportsUnionsWithBothNumberTypes: boolean;
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): SwiftRenderer;
    readonly dateTimeRecognizer: DateTimeRecognizer;
}
export declare class SwiftRenderer extends ConvenienceRenderer {
    private readonly _options;
    private _currentFilename;
    private _needAny;
    private _needNull;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _options: OptionValues<typeof swiftOptions>);
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected forbiddenForObjectProperties(_c: ClassType, _classNamed: Name): ForbiddenWordsInfo;
    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo;
    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo;
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected makeUnionMemberNamer(): Namer;
    protected makeEnumCaseNamer(): Namer;
    protected isImplicitCycleBreaker(t: Type): boolean;
    protected emitDescriptionBlock(lines: Sourcelike[]): void;
    private emitBlock;
    private emitBlockWithAccess;
    private justTypesCase;
    private readonly lowerNamingFunction;
    protected swiftPropertyType(p: ClassProperty): Sourcelike;
    protected swiftType(t: Type, withIssues?: boolean, noOptional?: boolean): Sourcelike;
    protected proposedUnionMemberNameForTypeKind(kind: TypeKind): string | null;
    private renderSingleFileHeaderComments;
    private renderHeader;
    private renderTopLevelAlias;
    protected getProtocolsArray(_t: Type, isClass: boolean): string[];
    private getProtocolString;
    private getEnumPropertyGroups;
    private readonly accessLevel;
    private readonly objcMembersDeclaration;
    protected startFile(basename: Sourcelike): void;
    protected endFile(): void;
    protected propertyLinesDefinition(name: Name, parameter: ClassProperty): Sourcelike;
    private renderClassDefinition;
    protected initializableProperties(c: ClassType): SwiftProperty[];
    private emitNewEncoderDecoder;
    private emitConvenienceInitializersExtension;
    private renderEnumDefinition;
    private renderUnionDefinition;
    private emitTopLevelMapAndArrayConvenienceInitializerExtensions;
    private emitDecodingError;
    private emitSupportFunctions4;
    private emitConvenienceMutator;
    protected emitMark(line: Sourcelike, horizontalLine?: boolean): void;
    protected emitSourceStructure(): void;
    private emitURLSessionExtension;
    private emitAlamofireExtension;
}

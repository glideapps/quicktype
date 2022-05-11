import { TargetLanguage } from "../TargetLanguage";
import { EnumOption, StringOption, BooleanOption, Option, OptionValues } from "../RendererOptions";
import { Type, ClassType, UnionType } from "../Type";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Namer, Name } from "../Naming";
import { Sourcelike } from "../Source";
import { RenderContext } from "../Renderer";
export declare const haskellOptions: {
    justTypes: BooleanOption;
    useList: EnumOption<boolean>;
    moduleName: StringOption;
};
export declare class HaskellTargetLanguage extends TargetLanguage {
    constructor();
    protected getOptions(): Option<any>[];
    readonly supportsOptionalClassProperties: boolean;
    readonly supportsUnionsWithBothNumberTypes: boolean;
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): HaskellRenderer;
}
export declare class HaskellRenderer extends ConvenienceRenderer {
    private readonly _options;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _options: OptionValues<typeof haskellOptions>);
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo;
    protected makeUnionMemberNamer(): Namer;
    protected readonly unionMembersInGlobalNamespace: boolean;
    protected makeEnumCaseNamer(): Namer;
    protected readonly enumCasesInGlobalNamespace: boolean;
    protected proposeUnionMemberName(u: UnionType, unionName: Name, fieldType: Type, lookup: (n: Name) => string): string;
    protected readonly commentLineStart: string;
    protected emitDescriptionBlock(lines: Sourcelike[]): void;
    private haskellType;
    private haskellProperty;
    private encoderNameForType;
    private emitTopLevelDefinition;
    private emitClassDefinition;
    private emitEnumDefinition;
    private emitUnionDefinition;
    private emitTopLevelFunctions;
    private classPropertyLength;
    private emitClassEncoderInstance;
    private emitClassDecoderInstance;
    private emitClassFunctions;
    private emitEnumEncoderInstance;
    private emitEnumDecoderInstance;
    private emitEnumFunctions;
    private emitUnionEncoderInstance;
    private emitUnionDecoderInstance;
    private emitUnionFunctions;
    private emitLanguageExtensions;
    protected emitSourceStructure(): void;
}

import { TargetLanguage } from "../TargetLanguage";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Name, Namer } from "../Naming";
import { UnionType, Type, ClassType, EnumType } from "../Type";
import { Sourcelike } from "../Source";
import { BooleanOption, EnumOption, Option, OptionValues } from "../RendererOptions";
import { RenderContext } from "../Renderer";
export declare enum Density {
    Normal = 0,
    Dense = 1
}
export declare enum Visibility {
    Private = 0,
    Crate = 1,
    Public = 2
}
export declare const rustOptions: {
    density: EnumOption<Density>;
    visibility: EnumOption<Visibility>;
    deriveDebug: BooleanOption;
    edition2018: BooleanOption;
    leadingComments: BooleanOption;
};
export declare class RustTargetLanguage extends TargetLanguage {
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): RustRenderer;
    constructor();
    protected getOptions(): Option<any>[];
}
export declare class RustRenderer extends ConvenienceRenderer {
    private readonly _options;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _options: OptionValues<typeof rustOptions>);
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer | null;
    protected makeUnionMemberNamer(): Namer | null;
    protected makeEnumCaseNamer(): Namer | null;
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo;
    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo;
    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo;
    protected readonly commentLineStart: string;
    private nullableRustType;
    protected isImplicitCycleBreaker(t: Type): boolean;
    private rustType;
    private breakCycle;
    private emitRenameAttribute;
    private readonly visibility;
    protected emitStructDefinition(c: ClassType, className: Name): void;
    protected emitBlock(line: Sourcelike, f: () => void): void;
    protected emitUnion(u: UnionType, unionName: Name): void;
    protected emitEnumDefinition(e: EnumType, enumName: Name): void;
    protected emitTopLevelAlias(t: Type, name: Name): void;
    protected emitLeadingComments(): void;
    protected emitSourceStructure(): void;
}

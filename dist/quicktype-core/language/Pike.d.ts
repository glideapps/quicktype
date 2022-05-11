import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Name, Namer } from "../Naming";
import { Option } from "../RendererOptions";
import { RenderContext } from "../Renderer";
import { MultiWord } from "../Source";
import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, UnionType } from "../Type";
export declare const pikeOptions: {};
export declare class PikeTargetLanguage extends TargetLanguage {
    constructor();
    protected getOptions(): Option<any>[];
    protected makeRenderer(renderContext: RenderContext): PikeRenderer;
}
export declare class PikeRenderer extends ConvenienceRenderer {
    protected emitSourceStructure(): void;
    protected readonly enumCasesInGlobalNamespace: boolean;
    protected makeEnumCaseNamer(): Namer;
    protected makeNamedTypeNamer(): Namer;
    protected makeUnionMemberNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo;
    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo;
    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo;
    protected sourceFor(t: Type): MultiWord;
    protected emitClassDefinition(c: ClassType, className: Name): void;
    protected emitEnum(e: EnumType, enumName: Name): void;
    protected emitUnion(u: UnionType, unionName: Name): void;
    private emitBlock;
    private emitMappingBlock;
    private emitClassMembers;
    private emitInformationComment;
    private emitTopLevelTypedef;
    private emitTopLevelConverter;
    private emitEncodingFunction;
    private emitDecodingFunction;
}

import { Type, UnionType, ClassType, EnumType } from "../Type";
import { Sourcelike, MultiWord } from "../Source";
import { Name, Namer } from "../Naming";
import { BooleanOption, Option, OptionValues } from "../RendererOptions";
import { JavaScriptTargetLanguage, JavaScriptRenderer, JavaScriptTypeAnnotations } from "./JavaScript";
import { TargetLanguage } from "../TargetLanguage";
import { RenderContext } from "../Renderer";
export declare const tsFlowOptions: {
    acronymStyle: import("../RendererOptions").EnumOption<import("../support/Acronyms").AcronymStyleOptions>;
    runtimeTypecheck: BooleanOption;
    runtimeTypecheckIgnoreUnknownProperties: BooleanOption;
    converters: import("../RendererOptions").EnumOption<import("../support/Converters").ConvertersOptions>;
    rawType: import("../RendererOptions").EnumOption<"any" | "json">;
} & {
    justTypes: BooleanOption;
    nicePropertyNames: BooleanOption;
    declareUnions: BooleanOption;
    preferUnions: BooleanOption;
};
export declare abstract class TypeScriptFlowBaseTargetLanguage extends JavaScriptTargetLanguage {
    protected getOptions(): Option<any>[];
    readonly supportsOptionalClassProperties: boolean;
    protected abstract makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): JavaScriptRenderer;
}
export declare class TypeScriptTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor();
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): TypeScriptRenderer;
}
export declare abstract class TypeScriptFlowBaseRenderer extends JavaScriptRenderer {
    protected readonly _tsFlowOptions: OptionValues<typeof tsFlowOptions>;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _tsFlowOptions: OptionValues<typeof tsFlowOptions>);
    protected namerForObjectProperty(): Namer;
    protected sourceFor(t: Type): MultiWord;
    protected abstract emitEnum(e: EnumType, enumName: Name): void;
    protected abstract emitClassBlock(c: ClassType, className: Name): void;
    protected emitClassBlockBody(c: ClassType): void;
    private emitClass;
    emitUnion(u: UnionType, unionName: Name): void;
    protected emitTypes(): void;
    protected emitUsageComments(): void;
    protected deserializerFunctionLine(t: Type, name: Name): Sourcelike;
    protected serializerFunctionLine(t: Type, name: Name): Sourcelike;
    protected readonly moduleLine: string | undefined;
    protected readonly castFunctionLines: [string, string];
    protected readonly typeAnnotations: JavaScriptTypeAnnotations;
    protected emitConvertModule(): void;
    protected emitConvertModuleHelpers(): void;
    protected emitModuleExports(): void;
}
export declare class TypeScriptRenderer extends TypeScriptFlowBaseRenderer {
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected deserializerFunctionLine(t: Type, name: Name): Sourcelike;
    protected serializerFunctionLine(t: Type, name: Name): Sourcelike;
    protected readonly moduleLine: string | undefined;
    protected readonly typeAnnotations: JavaScriptTypeAnnotations;
    protected emitModuleExports(): void;
    protected emitUsageImportComment(): void;
    protected emitEnum(e: EnumType, enumName: Name): void;
    protected emitClassBlock(c: ClassType, className: Name): void;
}
export declare class FlowTargetLanguage extends TypeScriptFlowBaseTargetLanguage {
    constructor();
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): FlowRenderer;
}
export declare class FlowRenderer extends TypeScriptFlowBaseRenderer {
    protected forbiddenNamesForGlobalNamespace(): string[];
    protected readonly typeAnnotations: JavaScriptTypeAnnotations;
    protected emitEnum(e: EnumType, enumName: Name): void;
    protected emitClassBlock(c: ClassType, className: Name): void;
    protected emitSourceStructure(): void;
}

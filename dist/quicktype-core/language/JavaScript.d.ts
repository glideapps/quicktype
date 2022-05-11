import { Type, ClassProperty, ClassType } from "../Type";
import { AcronymStyleOptions } from "../support/Acronyms";
import { ConvertersOptions } from "../support/Converters";
import { Sourcelike } from "../Source";
import { Namer, Name } from "../Naming";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { StringTypeMapping } from "../TypeBuilder";
import { BooleanOption, Option, OptionValues, EnumOption } from "../RendererOptions";
import { RenderContext } from "../Renderer";
export declare const javaScriptOptions: {
    acronymStyle: EnumOption<AcronymStyleOptions>;
    runtimeTypecheck: BooleanOption;
    runtimeTypecheckIgnoreUnknownProperties: BooleanOption;
    converters: EnumOption<ConvertersOptions>;
    rawType: EnumOption<"any" | "json">;
};
export declare type JavaScriptTypeAnnotations = {
    any: string;
    anyArray: string;
    anyMap: string;
    string: string;
    stringArray: string;
    boolean: string;
    never: string;
};
export declare class JavaScriptTargetLanguage extends TargetLanguage {
    constructor(displayName?: string, names?: string[], extension?: string);
    protected getOptions(): Option<any>[];
    readonly stringTypeMapping: StringTypeMapping;
    readonly supportsOptionalClassProperties: boolean;
    readonly supportsFullObjectType: boolean;
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): JavaScriptRenderer;
}
export declare const legalizeName: (s: string) => string;
export declare class JavaScriptRenderer extends ConvenienceRenderer {
    private readonly _jsOptions;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _jsOptions: OptionValues<typeof javaScriptOptions>);
    protected nameStyle(original: string, upper: boolean): string;
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected makeUnionMemberNamer(): null;
    protected makeEnumCaseNamer(): Namer;
    protected namedTypeToNameForTopLevel(type: Type): Type | undefined;
    protected makeNameForProperty(c: ClassType, className: Name, p: ClassProperty, jsonName: string, _assignedName: string | undefined): Name | undefined;
    protected emitDescriptionBlock(lines: Sourcelike[]): void;
    typeMapTypeFor(t: Type): Sourcelike;
    typeMapTypeForProperty(p: ClassProperty): Sourcelike;
    emitBlock(source: Sourcelike, end: Sourcelike, emit: () => void): void;
    emitTypeMap(): void;
    protected deserializerFunctionName(name: Name): Sourcelike;
    protected deserializerFunctionLine(_t: Type, name: Name): Sourcelike;
    protected serializerFunctionName(name: Name): Sourcelike;
    protected serializerFunctionLine(_t: Type, name: Name): Sourcelike;
    protected readonly moduleLine: string | undefined;
    protected readonly castFunctionLines: [string, string];
    protected readonly typeAnnotations: JavaScriptTypeAnnotations;
    protected emitConvertModuleBody(): void;
    protected emitConvertModuleHelpers(): void;
    protected emitConvertModule(): void;
    protected emitTypes(): void;
    protected emitUsageImportComment(): void;
    protected emitUsageComments(): void;
    protected emitModuleExports(): void;
    protected emitSourceStructure(): void;
}

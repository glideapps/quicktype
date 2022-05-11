import { TargetLanguage } from "../TargetLanguage";
import { Option, OptionValues, EnumOption } from "../RendererOptions";
import { RenderContext } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Name, Namer } from "../Naming";
import { AcronymStyleOptions } from "../support/Acronyms";
import { ClassProperty, ClassType, Sourcelike, Type } from "..";
export declare const javaScriptPropTypesOptions: {
    acronymStyle: EnumOption<AcronymStyleOptions>;
    converters: EnumOption<import("../support/Converters").ConvertersOptions>;
    moduleSystem: EnumOption<boolean>;
};
export declare class JavaScriptPropTypesTargetLanguage extends TargetLanguage {
    protected getOptions(): Option<any>[];
    constructor(displayName?: string, names?: string[], extension?: string);
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: {
        [name: string]: any;
    }): JavaScriptPropTypesRenderer;
}
export declare class JavaScriptPropTypesRenderer extends ConvenienceRenderer {
    private readonly _jsOptions;
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _jsOptions: OptionValues<typeof javaScriptPropTypesOptions>);
    protected nameStyle(original: string, upper: boolean): string;
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): Namer;
    protected makeUnionMemberNamer(): null;
    protected makeEnumCaseNamer(): Namer;
    protected namedTypeToNameForTopLevel(type: Type): Type | undefined;
    protected makeNameForProperty(c: ClassType, className: Name, p: ClassProperty, jsonName: string, _assignedName: string | undefined): Name | undefined;
    typeMapTypeFor(t: Type, required?: boolean): Sourcelike;
    typeMapTypeForProperty(p: ClassProperty): Sourcelike;
    private importStatement;
    protected emitUsageComments(): void;
    protected emitBlock(source: Sourcelike, end: Sourcelike, emit: () => void): void;
    protected emitImports(): void;
    private emitExport;
    protected emitTypes(): void;
    private emitObject;
    protected emitSourceStructure(): void;
}

import { TypeGraph } from "./TypeGraph";
import { Renderer, RenderContext } from "./Renderer";
import { OptionDefinition, Option } from "./RendererOptions";
import { SerializedRenderResult } from "./Source";
import { StringTypeMapping } from "./TypeBuilder";
import { Type } from "./Type";
import { DateTimeRecognizer } from "./DateTime";
export declare type MultiFileRenderResult = ReadonlyMap<string, SerializedRenderResult>;
export declare abstract class TargetLanguage {
    readonly displayName: string;
    readonly names: string[];
    readonly extension: string;
    constructor(displayName: string, names: string[], extension: string);
    protected abstract getOptions(): Option<any>[];
    readonly optionDefinitions: OptionDefinition[];
    readonly cliOptionDefinitions: {
        display: OptionDefinition[];
        actual: OptionDefinition[];
    };
    readonly name: string;
    protected abstract makeRenderer(renderContext: RenderContext, optionValues: {
        [name: string]: any;
    }): Renderer;
    renderGraphAndSerialize(typeGraph: TypeGraph, givenOutputFilename: string, alphabetizeProperties: boolean, leadingComments: string[] | undefined, rendererOptions: {
        [name: string]: any;
    }, indentation?: string): MultiFileRenderResult;
    protected readonly defaultIndentation: string;
    readonly stringTypeMapping: StringTypeMapping;
    readonly supportsOptionalClassProperties: boolean;
    readonly supportsUnionsWithBothNumberTypes: boolean;
    readonly supportsFullObjectType: boolean;
    needsTransformerForType(_t: Type): boolean;
    readonly dateTimeRecognizer: DateTimeRecognizer;
}

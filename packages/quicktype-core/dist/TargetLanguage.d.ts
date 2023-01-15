import { TypeGraph } from "./TypeGraph";
import { Renderer, RenderContext } from "./Renderer";
import { OptionDefinition, Option } from "./RendererOptions";
import { SerializedRenderResult } from "./Source";
import { StringTypeMapping } from "./TypeBuilder";
import { Type } from "./Type";
import { DateTimeRecognizer } from "./DateTime";
export type MultiFileRenderResult = ReadonlyMap<string, SerializedRenderResult>;
export declare abstract class TargetLanguage {
    readonly displayName: string;
    readonly names: string[];
    readonly extension: string;
    constructor(displayName: string, names: string[], extension: string);
    protected abstract getOptions(): Option<any>[];
    get optionDefinitions(): OptionDefinition[];
    get cliOptionDefinitions(): {
        display: OptionDefinition[];
        actual: OptionDefinition[];
    };
    get name(): string;
    protected abstract makeRenderer(renderContext: RenderContext, optionValues: {
        [name: string]: any;
    }): Renderer;
    renderGraphAndSerialize(typeGraph: TypeGraph, givenOutputFilename: string, alphabetizeProperties: boolean, leadingComments: string[] | undefined, rendererOptions: {
        [name: string]: any;
    }, indentation?: string): MultiFileRenderResult;
    protected get defaultIndentation(): string;
    get stringTypeMapping(): StringTypeMapping;
    get supportsOptionalClassProperties(): boolean;
    get supportsUnionsWithBothNumberTypes(): boolean;
    get supportsFullObjectType(): boolean;
    needsTransformerForType(_t: Type): boolean;
    get dateTimeRecognizer(): DateTimeRecognizer;
}

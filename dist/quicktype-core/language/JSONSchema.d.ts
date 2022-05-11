import { TargetLanguage } from "../TargetLanguage";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Namer } from "../Naming";
import { StringTypeMapping } from "../TypeBuilder";
import { Option } from "../RendererOptions";
import { RenderContext } from "../Renderer";
export declare class JSONSchemaTargetLanguage extends TargetLanguage {
    constructor();
    protected getOptions(): Option<any>[];
    readonly stringTypeMapping: StringTypeMapping;
    readonly supportsOptionalClassProperties: boolean;
    readonly supportsFullObjectType: boolean;
    protected makeRenderer(renderContext: RenderContext, _untypedOptionValues: {
        [name: string]: any;
    }): JSONSchemaRenderer;
}
export declare class JSONSchemaRenderer extends ConvenienceRenderer {
    protected makeNamedTypeNamer(): Namer;
    protected namerForObjectProperty(): null;
    protected makeUnionMemberNamer(): null;
    protected makeEnumCaseNamer(): null;
    private nameForType;
    private makeOneOf;
    private makeRef;
    private addAttributesToSchema;
    private schemaForType;
    private definitionForObject;
    private definitionForUnion;
    private definitionForEnum;
    protected emitSourceStructure(): void;
}

import { CompressedJSON } from "./CompressedJSON";
import { TypeBuilder } from "../TypeBuilder";
import { TargetLanguage } from "../TargetLanguage";
import { RunContext } from "../Run";
export interface Input<T> {
    readonly kind: string;
    readonly needIR: boolean;
    readonly needSchemaProcessing: boolean;
    addSource(source: T): Promise<void>;
    addSourceSync(source: T): void;
    singleStringSchemaSource(): string | undefined;
    addTypes(ctx: RunContext, typeBuilder: TypeBuilder, inferMaps: boolean, inferEnums: boolean, fixedTopLevels: boolean): Promise<void>;
    addTypesSync(ctx: RunContext, typeBuilder: TypeBuilder, inferMaps: boolean, inferEnums: boolean, fixedTopLevels: boolean): void;
}
export interface JSONSourceData<T> {
    name: string;
    samples: T[];
    description?: string;
}
export declare class JSONInput<T> implements Input<JSONSourceData<T>> {
    private readonly _compressedJSON;
    readonly kind: string;
    readonly needIR: boolean;
    readonly needSchemaProcessing: boolean;
    private readonly _topLevels;
    constructor(_compressedJSON: CompressedJSON<T>);
    private addSample;
    private setDescription;
    private addSamples;
    addSource(source: JSONSourceData<T>): Promise<void>;
    addSourceSync(source: JSONSourceData<T>): void;
    singleStringSchemaSource(): undefined;
    addTypes(ctx: RunContext, typeBuilder: TypeBuilder, inferMaps: boolean, inferEnums: boolean, fixedTopLevels: boolean): Promise<void>;
    addTypesSync(_ctx: RunContext, typeBuilder: TypeBuilder, inferMaps: boolean, inferEnums: boolean, fixedTopLevels: boolean): void;
}
export declare function jsonInputForTargetLanguage(targetLanguage: string | TargetLanguage, languages?: TargetLanguage[], handleJSONRefs?: boolean): JSONInput<string>;
export declare class InputData {
    private _inputs;
    addInput<T>(input: Input<T>): void;
    private getOrAddInput;
    addSource<T>(kind: string, source: T, makeInput: () => Input<T>): Promise<void>;
    addSourceSync<T>(kind: string, source: T, makeInput: () => Input<T>): void;
    addTypes(ctx: RunContext, typeBuilder: TypeBuilder, inferMaps: boolean, inferEnums: boolean, fixedTopLevels: boolean): Promise<void>;
    addTypesSync(ctx: RunContext, typeBuilder: TypeBuilder, inferMaps: boolean, inferEnums: boolean, fixedTopLevels: boolean): void;
    readonly needIR: boolean;
    readonly needSchemaProcessing: boolean;
    singleStringSchemaSource(): string | undefined;
}

import { TypeBuilder, Input, RunContext } from "../quicktype-core";
export declare type GraphQLSourceData = {
    name: string;
    schema: any;
    query: string;
};
export declare class GraphQLInput implements Input<GraphQLSourceData> {
    readonly kind: string;
    readonly needIR: boolean;
    readonly needSchemaProcessing: boolean;
    private readonly _topLevels;
    addSource(source: GraphQLSourceData): Promise<void>;
    addSourceSync(source: GraphQLSourceData): void;
    singleStringSchemaSource(): undefined;
    addTypes(ctx: RunContext, typeBuilder: TypeBuilder): Promise<void>;
    addTypesSync(_ctx: RunContext, typeBuilder: TypeBuilder): void;
}

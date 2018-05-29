import { StringMap, assert } from "../support/Support";
import { messageError } from "../Messages";

export type JSONSchema = StringMap | boolean;

export abstract class JSONSchemaStore {
    private readonly _schemas = new Map<string, JSONSchema>();

    private add(address: string, schema: JSONSchema): void {
        assert(!this._schemas.has(address), "Cannot set a schema for an address twice");
        this._schemas.set(address, schema);
    }

    // FIXME: Remove the undefined option
    abstract async fetch(_address: string): Promise<JSONSchema | undefined>;

    async get(address: string): Promise<JSONSchema> {
        let schema = this._schemas.get(address);
        if (schema !== undefined) {
            return schema;
        }
        schema = await this.fetch(address);
        if (schema === undefined) {
            return messageError("SchemaCannotFetch", { address });
        }
        this.add(address, schema);
        return schema;
    }
}

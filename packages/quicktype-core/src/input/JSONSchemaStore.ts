import { type StringMap } from "../support/Support";
import { assert } from "../support/Support";

export type JSONSchema = StringMap | boolean;

export abstract class JSONSchemaStore {
    private readonly _schemas = new Map<string, JSONSchema>();

    private add(address: string, schema: JSONSchema): void {
        assert(!this._schemas.has(address), "Cannot set a schema for an address twice");
        this._schemas.set(address, schema);
    }

    // FIXME: Remove the undefined option
    public abstract fetch(_address: string): Promise<JSONSchema | undefined>;

    public async get(address: string, debugPrint: boolean): Promise<JSONSchema | undefined> {
        let schema = this._schemas.get(address);
        if (schema !== undefined) {
            return schema;
        }

        if (debugPrint) {
            console.log(`trying to fetch ${address}`);
        }

        try {
            schema = await this.fetch(address);
        } catch {}

        if (schema === undefined) {
            if (debugPrint) {
                console.log(`couldn't fetch ${address}`);
            }

            return undefined;
        }

        if (debugPrint) {
            console.log(`successully fetched ${address}`);
        }

        this.add(address, schema);
        return schema;
    }
}

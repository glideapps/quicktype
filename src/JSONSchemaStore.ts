"use strict";

import { Map } from "immutable";
import { StringMap, assert } from "./Support";
import { ErrorMessage, messageError } from "./Messages";

export type JSONSchema = StringMap | boolean;

export abstract class JSONSchemaStore {
    private _schemas: Map<string, JSONSchema> = Map();

    private add(address: string, schema: JSONSchema): void {
        assert(!this._schemas.has(address), "Cannot set a schema for an address twice");
        this._schemas = this._schemas.set(address, schema);
    }

    abstract async fetch(_address: string): Promise<JSONSchema | undefined>;

    async get(address: string): Promise<JSONSchema> {
        let schema = this._schemas.get(address);
        if (schema !== undefined) {
            return schema;
        }
        schema = await this.fetch(address);
        if (schema === undefined) {
            return messageError(ErrorMessage.CannotFetchSchema, { address });
        }
        this.add(address, schema);
        return schema;
    }
}

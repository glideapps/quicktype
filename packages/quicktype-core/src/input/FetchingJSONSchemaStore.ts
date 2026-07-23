import { parseJSON } from "../support/ParseJSON.js";

import { readFromFileOrURL } from "./io/NodeIO.js";
import { type JSONSchema, JSONSchemaStore } from "./JSONSchemaStore.js";

export class FetchingJSONSchemaStore extends JSONSchemaStore {
    public constructor(private readonly _httpHeaders?: string[]) {
        super();
    }

    public async fetch(address: string): Promise<JSONSchema | undefined> {
        // console.log(`Fetching ${address}`);
        return parseJSON(
            await readFromFileOrURL(address, this._httpHeaders),
            "JSON Schema",
            address,
        );
    }
}

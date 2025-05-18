import { parseJSON } from "../support/Support";

import { readFromFileOrURL } from "./io/NodeIO";
import { type JSONSchema, JSONSchemaStore } from "./JSONSchemaStore";

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

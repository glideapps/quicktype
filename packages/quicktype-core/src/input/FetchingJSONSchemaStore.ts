import { JSONSchema, JSONSchemaStore } from "./JSONSchemaStore";
import { parseJSON } from "..";
import { readFromFileOrURL } from "./io/NodeIO";

export class FetchingJSONSchemaStore extends JSONSchemaStore {
    constructor(private readonly _httpHeaders?: string[]) {
        super();
    }

    async fetch(address: string): Promise<JSONSchema | undefined> {
        // console.log(`Fetching ${address}`);
        return parseJSON(await readFromFileOrURL(address, this._httpHeaders), "JSON Schema", address);
    }
}

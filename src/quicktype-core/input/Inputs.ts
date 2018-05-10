import * as URI from "urijs";
import { Map, List, Set } from "immutable";
import { getStream } from "../get-stream";
import { Readable } from "stream";

import { Ref, checkJSONSchema, refsInSchemaForURI } from "./JSONSchemaInput";
import { Value, CompressedJSON } from "./CompressedJSON";
import { JSONSchemaStore, JSONSchema } from "./JSONSchemaStore";
import {
    parseJSON,
    panic,
    assertNever,
    assert,
    forEachSync,
    defined,
    withDefault,
    errorMessage,
    hasOwnProperty
} from "../support/Support";
import { messageAssert, messageError } from "../Messages";
import {
    TypeSource,
    SchemaTypeSource,
    isSchemaSource,
    StringInput,
    isGraphQLSource,
    isJSONSource
} from "../TypeSource";

const stringToStream = require("string-to-stream");

function toReadable(source: string | Readable): Readable {
    return typeof source === "string" ? stringToStream(source) : source;
}

async function toString(source: string | Readable): Promise<string> {
    return typeof source === "string" ? source : await getStream(source);
}

class InputJSONSchemaStore extends JSONSchemaStore {
    constructor(private readonly _inputs: Map<string, StringInput>, private readonly _delegate?: JSONSchemaStore) {
        super();
    }

    async fetch(address: string): Promise<JSONSchema | undefined> {
        const maybeInput = this._inputs.get(address);
        if (maybeInput !== undefined) {
            return checkJSONSchema(parseJSON(await toString(maybeInput), "JSON Schema", address), () =>
                Ref.root(address)
            );
        }
        if (this._delegate === undefined) {
            return panic(`Schema URI ${address} requested, but no store given`);
        }
        return await this._delegate.fetch(address);
    }
}

export class InputData {
    private readonly _samples: { [name: string]: { samples: Value[]; description?: string } } = {};
    private readonly _schemas: { [name: string]: { ref: Ref } } = {};
    private readonly _graphQLs: { [name: string]: { schema: any; query: string } } = {};

    private _schemaInputs: Map<string, StringInput> = Map();
    private _schemaSources: List<[uri.URI, SchemaTypeSource]> = List();

    constructor(
        private readonly _compressedJSON: CompressedJSON,
        private readonly _givenSchemaStore: JSONSchemaStore | undefined
    ) {}

    get jsonInputs(): Map<string, { samples: Value[]; description?: string }> {
        return Map(this._samples);
    }

    get schemaInputs(): Map<string, Ref> {
        return Map(this._schemas).map(({ ref }) => ref);
    }

    get graphQLInputs(): Map<string, { schema: any; query: string }> {
        return Map(this._graphQLs);
    }

    // Returns whether we need IR for this type source
    private async addOtherTypeSource(source: TypeSource): Promise<boolean> {
        if (isGraphQLSource(source)) {
            const { name, schema, query } = source;
            this._graphQLs[name] = { schema, query: await toString(query) };

            return true;
        } else if (isJSONSource(source)) {
            const { name, samples, description } = source;
            for (const sample of samples) {
                let input: Value;
                try {
                    input = await this._compressedJSON.readFromStream(toReadable(sample));
                } catch (e) {
                    return messageError("MiscJSONParseError", {
                        description: withDefault(description, "input"),
                        address: name,
                        message: errorMessage(e)
                    });
                }
                if (!hasOwnProperty(this._samples, name)) {
                    this._samples[name] = { samples: [] };
                }
                this._samples[name].samples.push(input);
                if (description !== undefined) {
                    this._samples[name].description = description;
                }
            }

            return true;
        } else if (isSchemaSource(source)) {
            return false;
        }
        return assertNever(source);
    }

    private addSchemaTypeSource(schemaSource: SchemaTypeSource): void {
        const { uris, schema } = schemaSource;

        let normalizedURIs: uri.URI[];
        const uriPath = `-${this._schemaInputs.size + 1}`;
        if (uris === undefined) {
            normalizedURIs = [new URI(uriPath)];
        } else {
            normalizedURIs = uris.map(uri => {
                const normalizedURI = new URI(uri).normalize();
                if (
                    normalizedURI
                        .clone()
                        .hash("")
                        .toString() === ""
                ) {
                    normalizedURI.path(uriPath);
                }
                return normalizedURI;
            });
        }

        if (schema === undefined) {
            assert(uris !== undefined, "URIs must be given if schema source is not specified");
        } else {
            for (const normalizedURI of normalizedURIs) {
                this._schemaInputs = this._schemaInputs.set(
                    normalizedURI
                        .clone()
                        .hash("")
                        .toString(),
                    schema
                );
            }
        }

        for (const normalizedURI of normalizedURIs) {
            this._schemaSources = this._schemaSources.push([normalizedURI, schemaSource]);
        }
    }

    // Returns whether we need IR for this type source
    async addTypeSources(sources: TypeSource[]): Promise<boolean> {
        let needIR = false;

        for (const source of sources) {
            if (isSchemaSource(source)) {
                const isDirectInput = source.isConverted !== true;
                needIR = isDirectInput || needIR;

                this.addSchemaTypeSource(source);
            } else {
                needIR = (await this.addOtherTypeSource(source)) || needIR;
            }
        }

        return needIR;
    }

    private addSchemaInput(name: string, ref: Ref): void {
        messageAssert(!hasOwnProperty(this._schemas, name), "DriverMoreThanOneSchemaGiven", { name });
        this._schemas[name] = { ref };
    }

    async addSchemaInputs(): Promise<JSONSchemaStore | undefined> {
        if (this._schemaSources.isEmpty()) return undefined;

        let schemaStore = this._givenSchemaStore;
        if (this._schemaInputs.isEmpty()) {
            if (schemaStore === undefined) {
                return panic("Must have a schema store to process JSON Schema");
            }
        } else {
            schemaStore = new InputJSONSchemaStore(this._schemaInputs, schemaStore);
        }

        await forEachSync(this._schemaSources, async ([normalizedURI, source]) => {
            const givenName = source.name;

            const refs = await refsInSchemaForURI(defined(schemaStore), normalizedURI, givenName);
            if (Array.isArray(refs)) {
                let name: string;
                if (this._schemaSources.size === 1) {
                    name = givenName;
                } else {
                    name = refs[0];
                }
                this.addSchemaInput(name, refs[1]);
            } else {
                refs.forEach((ref, refName) => {
                    this.addSchemaInput(refName, ref);
                });
            }
        });

        return schemaStore;
    }

    singleStringSchemaSource(): string | undefined {
        if (!this._schemaSources.every(([_, { schema }]) => typeof schema === "string")) {
            return undefined;
        }
        const set = Set(this._schemaSources.map(([_, { schema }]) => schema as string));
        if (set.size === 1) {
            return defined(set.first());
        }
        return undefined;
    }
}

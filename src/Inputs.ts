import * as URI from "urijs";
import * as lodash from "lodash";
import { Map, List } from "immutable";
import { getStream } from "./get-stream";
import { Readable } from "stream";

import { schemaForTypeScriptSources } from "./TypeScriptInput";
import { Ref, checkJSONSchema, refsInSchemaForURI } from "./JSONSchemaInput";
import { Value, CompressedJSON } from "./CompressedJSON";
import { JSONSchemaStore, JSONSchema } from "./JSONSchemaStore";
import { parseJSON, panic, assertNever, assert, forEachSync, defined } from "./Support";
import { messageAssert, ErrorMessage } from "./Messages";

const stringToStream = require("string-to-stream");

function toReadable(source: string | Readable): Readable {
    return typeof source === "string" ? stringToStream(source) : source;
}

export async function toString(source: string | Readable): Promise<string> {
    return typeof source === "string" ? source : await getStream(source);
}

export type StringInput = string | Readable;

export interface JSONTypeSource {
    kind: "json";
    name: string;
    samples: StringInput[];
    description?: string;
}

function isJSONSource(source: TypeSource): source is JSONTypeSource {
    return source.kind === "json";
}

export interface TypeScriptTypeSource {
    kind: "typescript";
    sources: { [filename: string]: string };
}

function isTypeScriptSource(source: TypeSource): source is TypeScriptTypeSource {
    return source.kind === "typescript";
}

export interface SchemaTypeSource {
    kind: "schema";
    name: string;
    uri?: string;
    schema?: StringInput;
}

function isSchemaSource(source: TypeSource): source is SchemaTypeSource {
    return source.kind === "schema";
}

function toSchemaSource(source: TypeSource): [SchemaTypeSource, boolean] | undefined {
    if (isSchemaSource(source)) {
        return [source, true];
    } else if (isTypeScriptSource(source)) {
        return [{
            kind: "schema",
            name: "",
            schema: schemaForTypeScriptSources(source.sources),
            uri: "#/definitions/"
        }, false];
    }
    return undefined;
}

export interface GraphQLTypeSource {
    kind: "graphql";
    name: string;
    schema: any;
    query: StringInput;
}

function isGraphQLSource(source: TypeSource): source is GraphQLTypeSource {
    return source.kind === "graphql";
}

export type TypeSource = GraphQLTypeSource | JSONTypeSource | SchemaTypeSource | TypeScriptTypeSource;

class InputJSONSchemaStore extends JSONSchemaStore {
    constructor(private readonly _inputs: Map<string, StringInput>, private readonly _delegate?: JSONSchemaStore) {
        super();
    }

    async fetch(address: string): Promise<JSONSchema | undefined> {
        const maybeInput = this._inputs.get(address);
        if (maybeInput !== undefined) {
            return checkJSONSchema(parseJSON(await toString(maybeInput), "JSON Schema", address));
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

    constructor(private readonly _compressedJSON: CompressedJSON, private readonly _givenSchemaStore: JSONSchemaStore | undefined) {
    }

    get jsonInputs(): Map<string, { samples: Value[]; description?: string }> {
        return Map(this._samples);
    }

    get schemaInputs(): Map<string, Ref> {
        return Map(this._schemas).map(({ ref }) => ref);
    }

    get graphQLInputs(): Map<string, { schema: any; query: string }> {
        return Map(this._graphQLs);
    }

    get schemaSources(): List<[uri.URI, SchemaTypeSource]> {
        return this._schemaSources;
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
                const input = await this._compressedJSON.readFromStream(toReadable(sample));
                if (!lodash.has(this._samples, [name])) {
                    this._samples[name] = { samples: [] };
                }
                this._samples[name].samples.push(input);
                if (description !== undefined) {
                    this._samples[name].description = description;
                }
            }

            return true;
        } else if (isSchemaSource(source) || isTypeScriptSource(source)) {
            return false;
        }
        return assertNever(source);
    }

    private addSchemaTypeSource(schemaSource: SchemaTypeSource): void {
        const { uri, schema } = schemaSource;

        let normalizedURI: uri.URI;
        const uriPath = `-${this._schemaInputs.size + 1}`;
        if (uri === undefined) {
            normalizedURI = new URI(uriPath);
        } else {
            normalizedURI = new URI(uri).normalize();
            if (normalizedURI.clone().hash("").toString() === "") {
                normalizedURI.path(uriPath);
            }
        }

        if (schema === undefined) {
            assert(uri !== undefined, "URI must be given if schema source is not specified");
        } else {
            this._schemaInputs = this._schemaInputs.set(
                normalizedURI
                    .clone()
                    .hash("")
                    .toString(),
                schema
            );
        }

        this._schemaSources = this._schemaSources.push([normalizedURI, schemaSource]);
    }

    // Returns whether we need IR for this type source
    async addTypeSources(sources: TypeSource[]): Promise<boolean> {
        let needIR = false;

        for (const source of sources) {
            const maybeSchemaSource = toSchemaSource(source);

            if (maybeSchemaSource !== undefined) {
                const [schemaSource, isDirectInput] = maybeSchemaSource;
                needIR = isDirectInput || needIR;
    
                this.addSchemaTypeSource(schemaSource);
            } else {    
                needIR = await this.addOtherTypeSource(source) || needIR;
                continue;
            }
        }

        return needIR;
    }

    private addSchemaInput(name: string, ref: Ref): void {
        messageAssert(!lodash.has(this._schemas, [name]), ErrorMessage.MoreThanOneSchemaGiven, { name });
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
}

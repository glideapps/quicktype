import * as URI from "urijs";
import { OrderedMap, OrderedSet, Map, List, Set } from "immutable";
import { getStream } from "../get-stream";
import { Readable } from "stream";

import { Ref, checkJSONSchema, refsInSchemaForURI, addTypesInSchema } from "./JSONSchemaInput";
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
    errorMessage
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
import { makeGraphQLQueryTypes } from "../GraphQL";
import { TypeBuilder } from "../TypeBuilder";
import { makeNamesTypeAttributes } from "../TypeNames";
import { descriptionTypeAttributeKind } from "../TypeAttributes";
import { TypeInference } from "./Inference";

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

export interface Input {
    readonly kind: string;
    readonly needSchemaProcessing: boolean;

    addTypes(
        typeBuilder: TypeBuilder,
        inferEnums: boolean,
        inferDates: boolean,
        fixedTopLevels: boolean
    ): Promise<void>;

    // FIXME: Put needIR in here
}

type GraphQLTopLevel = { schema: any; query: string };

class GraphQLInput implements Input {
    readonly kind: string = "graphql";
    readonly needSchemaProcessing: boolean = false;

    private _topLevels: OrderedMap<string, GraphQLTopLevel> = OrderedMap();

    addTopLevel(name: string, schema: any, query: string): void {
        this._topLevels = this._topLevels.set(name, { schema, query });
    }

    async addTypes(typeBuilder: TypeBuilder): Promise<void> {
        this._topLevels.forEach(({ schema, query }, name) => {
            const newTopLevels = makeGraphQLQueryTypes(name, typeBuilder, schema, query);
            newTopLevels.forEach((t, actualName) => {
                typeBuilder.addTopLevel(this._topLevels.size === 1 ? name : actualName, t);
            });
        });
    }
}

type JSONTopLevel = { samples: Value[]; description: string | undefined };

class JSONInput implements Input {
    readonly kind: string = "json";
    readonly needSchemaProcessing: boolean = false;

    private _topLevels: OrderedMap<string, JSONTopLevel> = OrderedMap();

    /* tslint:disable:no-unused-variable */
    constructor(private readonly _compressedJSON: CompressedJSON) {}

    addSample(topLevelName: string, sample: Value): void {
        let topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            topLevel = { samples: [], description: undefined };
            this._topLevels = this._topLevels.set(topLevelName, topLevel);
        }
        topLevel.samples.push(sample);
    }

    setDescription(topLevelName: string, description: string): void {
        let topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            return panic("Trying to set description for a top-level that doesn't exist");
        }
        topLevel.description = description;
    }

    async addTypes(
        typeBuilder: TypeBuilder,
        inferEnums: boolean,
        inferDates: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
        const inference = new TypeInference(typeBuilder, inferEnums, inferDates);

        this._topLevels.forEach(({ samples, description }, name) => {
            const tref = inference.inferType(
                this._compressedJSON,
                makeNamesTypeAttributes(name, false),
                samples,
                fixedTopLevels
            );
            typeBuilder.addTopLevel(name, tref);
            if (description !== undefined) {
                const attributes = descriptionTypeAttributeKind.makeAttributes(OrderedSet([description]));
                typeBuilder.addAttributes(tref, attributes);
            }
        });
    }
}

class JSONSchemaInput implements Input {
    readonly kind: string = "schema";
    readonly needSchemaProcessing: boolean = true;

    private _topLevels: OrderedMap<string, Ref> = OrderedMap();

    constructor(private readonly _schemaStore: JSONSchemaStore) {}

    addTopLevel(name: string, ref: Ref): void {
        this._topLevels = this._topLevels.set(name, ref);
    }

    async addTypes(typeBuilder: TypeBuilder): Promise<void> {
        await addTypesInSchema(typeBuilder, this._schemaStore, this._topLevels);
    }
}

export class JSONSchemaSources {
    private _schemaInputs: Map<string, StringInput> = Map();
    private _schemaSources: List<[uri.URI, SchemaTypeSource]> = List();

    constructor(private readonly _givenSchemaStore: JSONSchemaStore | undefined) {}

    addSchemaTypeSource(schemaSource: SchemaTypeSource): void {
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

    async addInputs(inputData: InputData): Promise<JSONSchemaStore | undefined> {
        if (this._schemaSources.isEmpty()) return undefined;

        let maybeSchemaStore = this._givenSchemaStore;
        if (this._schemaInputs.isEmpty()) {
            if (maybeSchemaStore === undefined) {
                return panic("Must have a schema store to process JSON Schema");
            }
        } else {
            maybeSchemaStore = new InputJSONSchemaStore(this._schemaInputs, maybeSchemaStore);
        }
        const schemaStore = maybeSchemaStore;

        const schemaInput = new JSONSchemaInput(schemaStore);

        await forEachSync(this._schemaSources, async ([normalizedURI, source]) => {
            const givenName = source.name;

            const refs = await refsInSchemaForURI(schemaStore, normalizedURI, givenName);
            if (Array.isArray(refs)) {
                let name: string;
                if (this._schemaSources.size === 1) {
                    name = givenName;
                } else {
                    name = refs[0];
                }
                schemaInput.addTopLevel(name, refs[1]);
                inputData.addInput(name, schemaInput);
            } else {
                refs.forEach((ref, refName) => {
                    schemaInput.addTopLevel(refName, ref);
                    inputData.addInput(refName, schemaInput);
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

export class InputData {
    private _inputs: OrderedMap<string, Input> = OrderedMap();

    constructor(private readonly _compressedJSON: CompressedJSON) {}

    addInput(name: string, input: Input): void {
        messageAssert(!this._inputs.has(name), "DriverMoreThanOneInputGiven", { topLevel: name });
        this._inputs = this._inputs.set(name, input);
    }

    // Returns whether we need IR for this type source
    private async addOtherTypeSource(source: TypeSource): Promise<boolean> {
        let graphQLInput: GraphQLInput | undefined = undefined;
        let jsonInput: JSONInput | undefined = undefined;

        if (isGraphQLSource(source)) {
            const { name, schema, query } = source;
            if (graphQLInput === undefined) {
                graphQLInput = new GraphQLInput();
            }
            graphQLInput.addTopLevel(name, schema, await toString(query));
            this.addInput(name, graphQLInput);
            return true;
        } else if (isJSONSource(source)) {
            const { name, samples, description } = source;

            if (jsonInput === undefined) {
                jsonInput = new JSONInput(this._compressedJSON);
            }
            this.addInput(name, jsonInput);

            for (const sample of samples) {
                let value: Value;
                try {
                    value = await this._compressedJSON.readFromStream(toReadable(sample));
                } catch (e) {
                    return messageError("MiscJSONParseError", {
                        description: withDefault(description, "input"),
                        address: name,
                        message: errorMessage(e)
                    });
                }
                jsonInput.addSample(name, value);
                if (description !== undefined) {
                    jsonInput.setDescription(name, description);
                }
            }

            return true;
        } else if (isSchemaSource(source)) {
            return false;
        }
        return assertNever(source);
    }

    // Returns whether we need IR for this type source
    async addTypeSources(sources: TypeSource[], jsonSchemaSources: JSONSchemaSources): Promise<boolean> {
        let needIR = false;

        for (const source of sources) {
            if (isSchemaSource(source)) {
                const isDirectInput = source.isConverted !== true;
                needIR = isDirectInput || needIR;

                jsonSchemaSources.addSchemaTypeSource(source);
            } else {
                needIR = (await this.addOtherTypeSource(source)) || needIR;
            }
        }

        return needIR;
    }

    async addTypes(
        typeBuilder: TypeBuilder,
        inferEnums: boolean,
        inferDates: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
        // We're comparing for identity in this OrderedSet, i.e.,
        // we do each input exactly once.
        await forEachSync(this._inputs.toOrderedSet(), async input => {
            await input.addTypes(typeBuilder, inferEnums, inferDates, fixedTopLevels);
        });
    }

    get needSchemaProcessing(): boolean {
        return this._inputs.some(i => i.needSchemaProcessing);
    }
}

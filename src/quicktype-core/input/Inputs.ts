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

export abstract class Input {
    constructor(readonly kind: string) {}

    abstract get needSchemaProcessing(): boolean;

    abstract async addTypesFromInputs(
        inputs: OrderedMap<string, this>,
        typeBuilder: TypeBuilder,
        compressedJSON: CompressedJSON,
        inferEnums: boolean,
        inferDates: boolean,
        fixedTopLevels: boolean
    ): Promise<void>;

    // FIXME: Put needIR in here
}

class GraphQLInput extends Input {
    /* tslint:disable:no-unused-variable */
    constructor(private readonly _schema: any, private readonly _query: string) {
        super("graphql");
    }

    get needSchemaProcessing(): boolean {
        return false;
    }

    async addTypesFromInputs(inputs: OrderedMap<string, this>, typeBuilder: TypeBuilder): Promise<void> {
        inputs.forEach((input, name) => {
            const newTopLevels = makeGraphQLQueryTypes(name, typeBuilder, input._schema, input._query);
            newTopLevels.forEach((t, actualName) => {
                typeBuilder.addTopLevel(inputs.size === 1 ? name : actualName, t);
            });
        });
    }
}

class JSONInput extends Input {
    /* tslint:disable:no-unused-variable */
    constructor(private readonly _samples: Value[], private _description: string | undefined) {
        super("json");
    }

    addSample(sample: Value): void {
        this._samples.push(sample);
    }

    get description(): string | undefined {
        return this._description;
    }

    setDescription(description: string): void {
        this._description = description;
    }

    get needSchemaProcessing(): boolean {
        return false;
    }

    async addTypesFromInputs(
        inputs: OrderedMap<string, this>,
        typeBuilder: TypeBuilder,
        compressedJSON: CompressedJSON,
        inferEnums: boolean,
        inferDates: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
        const inference = new TypeInference(typeBuilder, inferEnums, inferDates);

        inputs.forEach((input, name) => {
            const samples = input._samples;
            const description = input.description;

            const tref = inference.inferType(
                compressedJSON as CompressedJSON,
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

class JSONSchemaInput extends Input {
    /**
     * We're assuming that all schema inputs use the same schema store, i.e., you have
     * to pass in the same schema store into all your schema inputs.
     */
    /* tslint:disable:no-unused-variable */
    constructor(private readonly _ref: Ref, private readonly _schemaStore: JSONSchemaStore) {
        super("schema");
    }

    get needSchemaProcessing(): boolean {
        return true;
    }

    async addTypesFromInputs(inputs: OrderedMap<string, this>, typeBuilder: TypeBuilder): Promise<void> {
        await addTypesInSchema(typeBuilder, this._schemaStore, inputs.map(jsi => jsi._ref));
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
                inputData.addInput(name, new JSONSchemaInput(refs[1], schemaStore));
            } else {
                refs.forEach((ref, refName) => {
                    inputData.addInput(refName, new JSONSchemaInput(ref, schemaStore));
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
        if (isGraphQLSource(source)) {
            const { name, schema, query } = source;
            this.addInput(name, new GraphQLInput(schema, await toString(query)));
            return true;
        } else if (isJSONSource(source)) {
            const { name, samples, description } = source;
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
                let input = this._inputs.get(name);
                if (input === undefined) {
                    input = new JSONInput([], undefined);
                    this.addInput(name, input);
                } else {
                    if (!(input instanceof JSONInput)) {
                        return messageError("DriverCannotMixJSONWithOtherSamplesForTopLevel", { topLevel: name });
                    }
                }
                const jsonInput = input as JSONInput;
                jsonInput.addSample(value);
                if (description !== undefined) {
                    jsonInput.setDescription(description);
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
        compressedJSON: CompressedJSON,
        inferEnums: boolean,
        inferDates: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
        let kinds = this._inputs.map(i => i.kind).toOrderedSet();
        await forEachSync(kinds, async kind => {
            const inputs = this._inputs.filter(i => i.kind === kind);
            const first = defined(inputs.first());
            await first.addTypesFromInputs(inputs, typeBuilder, compressedJSON, inferEnums, inferDates, fixedTopLevels);
        });
    }

    get needSchemaProcessing(): boolean {
        return this._inputs.some(i => i.needSchemaProcessing);
    }
}

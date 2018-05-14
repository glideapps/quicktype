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
import { messageError } from "../Messages";
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

    finishAddingInputs(): void;

    singleStringSchemaSource(): string | undefined;

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

    async finishAddingInputs(): Promise<void> {}

    singleStringSchemaSource(): undefined {
        return undefined;
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

    async finishAddingInputs(): Promise<void> {}

    singleStringSchemaSource(): undefined {
        return undefined;
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

export class JSONSchemaInput implements Input {
    readonly kind: string = "schema";
    readonly needSchemaProcessing: boolean = true;

    private _schemaStore: JSONSchemaStore | undefined = undefined;

    private _schemaInputs: Map<string, StringInput> = Map();
    private _schemaSources: List<[uri.URI, SchemaTypeSource]> = List();

    private _topLevels: OrderedMap<string, Ref> = OrderedMap();

    constructor(givenSchemaStore: JSONSchemaStore | undefined) {
        this._schemaStore = givenSchemaStore;
    }

    addTopLevel(name: string, ref: Ref): void {
        this._topLevels = this._topLevels.set(name, ref);
    }

    async addTypes(typeBuilder: TypeBuilder): Promise<void> {
        await addTypesInSchema(typeBuilder, defined(this._schemaStore), this._topLevels);
    }

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

    async finishAddingInputs(): Promise<void> {
        if (this._schemaSources.isEmpty()) return;

        let maybeSchemaStore = this._schemaStore;
        if (this._schemaInputs.isEmpty()) {
            if (maybeSchemaStore === undefined) {
                return panic("Must have a schema store to process JSON Schema");
            }
        } else {
            maybeSchemaStore = this._schemaStore = new InputJSONSchemaStore(this._schemaInputs, maybeSchemaStore);
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
                this.addTopLevel(name, refs[1]);
            } else {
                refs.forEach((ref, refName) => {
                    this.addTopLevel(refName, ref);
                });
            }
        });
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
    // We're comparing for identity in this OrderedSet, i.e.,
    // we do each input exactly once.
    private _inputs: OrderedSet<Input> = OrderedSet();

    private _graphQLInput: GraphQLInput | undefined = undefined;
    private _jsonInput: JSONInput | undefined = undefined;
    private _schemaInput: JSONSchemaInput | undefined = undefined;

    addInput(input: Input): void {
        this._inputs = this._inputs.add(input);
    }

    // Returns whether we need IR for this type source
    private async addTypeSource(
        source: TypeSource,
        compressedJSON: CompressedJSON,
        jsonSchemaStore: JSONSchemaStore | undefined
    ): Promise<boolean> {
        if (isGraphQLSource(source)) {
            const { name, schema, query } = source;
            if (this._graphQLInput === undefined) {
                this._graphQLInput = new GraphQLInput();
                this.addInput(this._graphQLInput);
            }
            this._graphQLInput.addTopLevel(name, schema, await toString(query));
            return true;
        } else if (isJSONSource(source)) {
            const { name, samples, description } = source;

            if (this._jsonInput === undefined) {
                this._jsonInput = new JSONInput(compressedJSON);
                this.addInput(this._jsonInput);
            }

            for (const sample of samples) {
                let value: Value;
                try {
                    value = await compressedJSON.readFromStream(toReadable(sample));
                } catch (e) {
                    return messageError("MiscJSONParseError", {
                        description: withDefault(description, "input"),
                        address: name,
                        message: errorMessage(e)
                    });
                }
                this._jsonInput.addSample(name, value);
                if (description !== undefined) {
                    this._jsonInput.setDescription(name, description);
                }
            }

            return true;
        } else if (isSchemaSource(source)) {
            const isDirectInput = source.isConverted !== true;

            if (this._schemaInput === undefined) {
                this._schemaInput = new JSONSchemaInput(jsonSchemaStore);
                this.addInput(this._schemaInput);
            }
            this._schemaInput.addSchemaTypeSource(source);

            return isDirectInput;
        }
        return assertNever(source);
    }

    // Returns whether we need IR for this type source
    async addTypeSources(
        sources: TypeSource[],
        compressedJSON: CompressedJSON,
        jsonSchemaStore: JSONSchemaStore | undefined
    ): Promise<boolean> {
        let needIR = false;

        for (const source of sources) {
            needIR = (await this.addTypeSource(source, compressedJSON, jsonSchemaStore)) || needIR;
        }

        await forEachSync(this._inputs, async input => {
            await input.finishAddingInputs();
        });

        return needIR;
    }

    async addTypes(
        typeBuilder: TypeBuilder,
        inferEnums: boolean,
        inferDates: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
        await forEachSync(this._inputs, async input => {
            await input.addTypes(typeBuilder, inferEnums, inferDates, fixedTopLevels);
        });
    }

    get needSchemaProcessing(): boolean {
        return this._inputs.some(i => i.needSchemaProcessing);
    }

    singleStringSchemaSource(): string | undefined {
        const schemaStrings = this._inputs.map(i => i.singleStringSchemaSource()).filter(s => s !== undefined);
        if (schemaStrings.size > 1) {
            return panic("We have more than one input with a string schema source");
        }
        return schemaStrings.first();
    }
}

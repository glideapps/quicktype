import { iterableFirst, iterableFind, iterableSome, setFilterMap, withDefault, arrayMapSync } from "collection-utils";

import { Value, CompressedJSON, CompressedJSONFromString, CompressedJSON5FromString } from "./CompressedJSON";
import { panic, errorMessage, defined } from "../support/Support";
import { messageError } from "../Messages";
import { TypeBuilder } from "../TypeBuilder";
import { makeNamesTypeAttributes } from "../attributes/TypeNames";
import { descriptionTypeAttributeKind } from "../attributes/Description";
import { TypeInference } from "./Inference";
import { TargetLanguage } from "../TargetLanguage";
import { RunContext } from "../Run";
import { languageNamed } from "../language/All";

export interface Input<T> {
    readonly kind: string;
    readonly needIR: boolean;
    readonly needSchemaProcessing: boolean;

    addSource(source: T): Promise<void>;
    addSourceSync(source: T): void;

    singleStringSchemaSource(): string | undefined;

    addTypes(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): Promise<void>;
    addTypesSync(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): void;
}

type JSONTopLevel = { samples: Value[]; description: string | undefined };

export interface JSONSourceData<T> {
    name: string;
    samples: T[];
    description?: string;
}

function messageParseError(name: string, description: string | undefined, e: unknown): never {
    return messageError("MiscJSONParseError", {
        description: withDefault(description, "input"),
        address: name,
        message: errorMessage(e)
    });
}

export class JSONInput<T> implements Input<JSONSourceData<T>> {
    readonly kind: string = "json";
    readonly needIR: boolean = true;
    readonly needSchemaProcessing: boolean = false;

    private readonly _topLevels: Map<string, JSONTopLevel> = new Map();

    /* tslint:disable:no-unused-variable */
    constructor(private readonly _compressedJSON: CompressedJSON<T>) {}

    private addSample(topLevelName: string, sample: Value): void {
        let topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            topLevel = { samples: [], description: undefined };
            this._topLevels.set(topLevelName, topLevel);
        }
        topLevel.samples.push(sample);
    }

    private setDescription(topLevelName: string, description: string): void {
        let topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            return panic("Trying to set description for a top-level that doesn't exist");
        }
        topLevel.description = description;
    }

    private addSamples(name: string, values: Value[], description: string | undefined): void {
        for (const value of values) {
            this.addSample(name, value);
            if (description !== undefined) {
                this.setDescription(name, description);
            }
        }
    }

    async addSource(source: JSONSourceData<T>): Promise<void> {
        const { name, samples, description } = source;
        try {
            const values = await arrayMapSync(samples, async s => await this._compressedJSON.parse(s));
            this.addSamples(name, values, description);
        } catch (e) {
            return messageParseError(name, description, e);
        }
    }

    addSourceSync(source: JSONSourceData<T>): void {
        const { name, samples, description } = source;
        try {
            const values = samples.map(s => this._compressedJSON.parseSync(s));
            this.addSamples(name, values, description);
        } catch (e) {
            return messageParseError(name, description, e);
        }
    }

    singleStringSchemaSource(): undefined {
        return undefined;
    }

    async addTypes(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
        return this.addTypesSync(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels);
    }

    addTypesSync(
        _ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): void {
        const inference = new TypeInference(this._compressedJSON, typeBuilder, inferMaps, inferEnums);

        for (const [name, { samples, description }] of this._topLevels) {
            const tref = inference.inferTopLevelType(makeNamesTypeAttributes(name, false), samples, fixedTopLevels);
            typeBuilder.addTopLevel(name, tref);
            if (description !== undefined) {
                const attributes = descriptionTypeAttributeKind.makeAttributes(new Set([description]));
                typeBuilder.addAttributes(tref, attributes);
            }
        }
    }
}

export class JSON5Input<T> extends JSONInput<T> {
    readonly kind: string = "json5";
}

export function jsonInputForTargetLanguage(
    targetLanguage: string | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs: boolean = false
): JSONInput<string> {
    if (typeof targetLanguage === "string") {
        targetLanguage = defined(languageNamed(targetLanguage, languages));
    }
    const compressedJSON = new CompressedJSONFromString(targetLanguage.dateTimeRecognizer, handleJSONRefs);
    return new JSONInput(compressedJSON);
}

export function json5InputForTargetLanguage(
    targetLanguage: string | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs: boolean = false
): JSON5Input<string> {
    if (typeof targetLanguage === "string") {
        targetLanguage = defined(languageNamed(targetLanguage, languages));
    }
    const compressedJSON5 = new CompressedJSON5FromString(targetLanguage.dateTimeRecognizer, handleJSONRefs);
    return new JSON5Input(compressedJSON5);
}

export class InputData {
    // FIXME: Make into a Map, indexed by kind.
    private _inputs: Set<Input<any>> = new Set();

    addInput<T>(input: Input<T>): void {
        this._inputs = this._inputs.add(input);
    }

    private getOrAddInput<T>(kind: string, makeInput: () => Input<T>): Input<T> {
        let input: Input<T> | undefined = iterableFind(this._inputs, i => i.kind === kind);
        if (input === undefined) {
            input = makeInput();
            this.addInput(input);
        }
        return input;
    }

    async addSource<T>(kind: string, source: T, makeInput: () => Input<T>): Promise<void> {
        const input = this.getOrAddInput(kind, makeInput);
        await input.addSource(source);
    }

    addSourceSync<T>(kind: string, source: T, makeInput: () => Input<T>): void {
        const input = this.getOrAddInput(kind, makeInput);
        input.addSourceSync(source);
    }

    async addTypes(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
        for (const input of this._inputs) {
            await input.addTypes(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels);
        }
    }

    addTypesSync(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): void {
        for (const input of this._inputs) {
            input.addTypesSync(ctx, typeBuilder, inferMaps, inferEnums, fixedTopLevels);
        }
    }

    get needIR(): boolean {
        return iterableSome(this._inputs, i => i.needIR);
    }

    get needSchemaProcessing(): boolean {
        return iterableSome(this._inputs, i => i.needSchemaProcessing);
    }

    singleStringSchemaSource(): string | undefined {
        const schemaStrings = setFilterMap(this._inputs, i => i.singleStringSchemaSource());
        if (schemaStrings.size > 1) {
            return panic("We have more than one input with a string schema source");
        }
        return iterableFirst(schemaStrings);
    }
}

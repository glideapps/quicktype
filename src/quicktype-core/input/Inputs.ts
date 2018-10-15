import { iterableFirst, iterableFind, iterableSome, setFilterMap, withDefault } from "collection-utils";

import { Value, CompressedJSONFromStream } from "./CompressedJSON";
import { panic, errorMessage, toReadable, StringInput, defined } from "../support/Support";
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

    finishAddingInputs(): Promise<void>;

    singleStringSchemaSource(): string | undefined;

    addTypes(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): Promise<void>;
}

type JSONTopLevel = { samples: Value[]; description: string | undefined };

export interface JSONSourceData {
    name: string;
    samples: StringInput[];
    description?: string;
}

export class JSONInput implements Input<JSONSourceData> {
    readonly kind: string = "json";
    readonly needIR: boolean = true;
    readonly needSchemaProcessing: boolean = false;

    private readonly _topLevels: Map<string, JSONTopLevel> = new Map();

    /* tslint:disable:no-unused-variable */
    constructor(private readonly _compressedJSON: CompressedJSONFromStream) {}

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

    async addSource(source: JSONSourceData): Promise<void> {
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
            this.addSample(name, value);
            if (description !== undefined) {
                this.setDescription(name, description);
            }
        }
    }

    async finishAddingInputs(): Promise<void> {
        return;
    }

    singleStringSchemaSource(): undefined {
        return undefined;
    }

    async addTypes(
        _ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean
    ): Promise<void> {
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

export function jsonInputForTargetLanguage(
    targetLanguage: string | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs: boolean = false
): JSONInput {
    if (typeof targetLanguage === "string") {
        targetLanguage = defined(languageNamed(targetLanguage, languages));
    }
    const compressedJSON = new CompressedJSONFromStream(targetLanguage.dateTimeRecognizer, handleJSONRefs);
    return new JSONInput(compressedJSON);
}

export class InputData {
    // FIXME: Make into a Map, indexed by kind.
    private _inputs: Set<Input<any>> = new Set();

    addInput<T>(input: Input<T>): void {
        this._inputs = this._inputs.add(input);
    }

    async addSource<T>(kind: string, source: T, makeInput: () => Input<T>): Promise<void> {
        let input: Input<T> | undefined = iterableFind(this._inputs, i => i.kind === kind);
        if (input === undefined) {
            input = makeInput();
            this.addInput(input);
        }
        await input.addSource(source);
    }

    async finishAddingInputs(): Promise<void> {
        for (const input of this._inputs) {
            await input.finishAddingInputs();
        }
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

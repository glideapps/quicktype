import {
    arrayMapSync,
    iterableFind,
    iterableFirst,
    iterableSome,
    setFilterMap,
    withDefault,
} from "collection-utils";

import { descriptionTypeAttributeKind } from "../attributes/Description";
import { makeNamesTypeAttributes } from "../attributes/TypeNames";
import { languageNamed } from "../language/All";
import { messageError } from "../Messages";
import type { RunContext } from "../Run";
import { defined, errorMessage, panic } from "../support/Support";
import type { TargetLanguage } from "../TargetLanguage";
import type { TypeBuilder } from "../Type/TypeBuilder";
import type { LanguageName } from "../types";

import {
    type CompressedJSON,
    CompressedJSONFromString,
    type Value,
} from "./CompressedJSON";
import { TypeInference } from "./Inference";

export interface Input<T> {
    addSource: (source: T) => Promise<void>;
    addSourceSync: (source: T) => void;
    addTypes: (
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean,
    ) => Promise<void>;

    addTypesSync: (
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean,
    ) => void;
    readonly kind: string;

    readonly needIR: boolean;

    readonly needSchemaProcessing: boolean;
    singleStringSchemaSource: () => string | undefined;
}

interface JSONTopLevel {
    description: string | undefined;
    samples: Value[];
}

export interface JSONSourceData<T> {
    description?: string;
    name: string;
    samples: T[];
}

function messageParseError(
    name: string,
    description: string | undefined,
    e: unknown,
): never {
    return messageError("MiscJSONParseError", {
        description: withDefault(description, "input"),
        address: name,
        message: errorMessage(e),
    });
}

export class JSONInput<T> implements Input<JSONSourceData<T>> {
    public readonly kind: string = "json";

    public readonly needIR: boolean = true;

    public readonly needSchemaProcessing: boolean = false;

    private readonly _topLevels: Map<string, JSONTopLevel> = new Map();

    public constructor(private readonly _compressedJSON: CompressedJSON<T>) {}

    private addSample(topLevelName: string, sample: Value): void {
        let topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            topLevel = { samples: [], description: undefined };
            this._topLevels.set(topLevelName, topLevel);
        }

        topLevel.samples.push(sample);
    }

    private setDescription(topLevelName: string, description: string): void {
        const topLevel = this._topLevels.get(topLevelName);
        if (topLevel === undefined) {
            return panic(
                "Trying to set description for a top-level that doesn't exist",
            );
        }

        topLevel.description = description;
    }

    private addSamples(
        name: string,
        values: Value[],
        description: string | undefined,
    ): void {
        for (const value of values) {
            this.addSample(name, value);
            if (description !== undefined) {
                this.setDescription(name, description);
            }
        }
    }

    public async addSource(source: JSONSourceData<T>): Promise<void> {
        const { name, samples, description } = source;
        try {
            const values = await arrayMapSync(
                samples,
                async (s) => await this._compressedJSON.parse(s),
            );
            this.addSamples(name, values, description);
        } catch (e) {
            return messageParseError(name, description, e);
        }
    }

    public addSourceSync(source: JSONSourceData<T>): void {
        const { name, samples, description } = source;
        try {
            const values = samples.map((s) =>
                this._compressedJSON.parseSync(s),
            );
            this.addSamples(name, values, description);
        } catch (e) {
            return messageParseError(name, description, e);
        }
    }

    public singleStringSchemaSource(): undefined {
        return undefined;
    }

    public async addTypes(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean,
    ): Promise<void> {
        this.addTypesSync(
            ctx,
            typeBuilder,
            inferMaps,
            inferEnums,
            fixedTopLevels,
        );
    }

    public addTypesSync(
        _ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean,
    ): void {
        const inference = new TypeInference(
            this._compressedJSON,
            typeBuilder,
            inferMaps,
            inferEnums,
        );

        for (const [name, { samples, description }] of this._topLevels) {
            const tref = inference.inferTopLevelType(
                makeNamesTypeAttributes(name, false),
                samples,
                fixedTopLevels,
            );
            typeBuilder.addTopLevel(name, tref);
            if (description !== undefined) {
                const attributes = descriptionTypeAttributeKind.makeAttributes(
                    new Set([description]),
                );
                typeBuilder.addAttributes(tref, attributes);
            }
        }
    }
}

export function jsonInputForTargetLanguage(
    targetLanguage: LanguageName | TargetLanguage,
    languages?: TargetLanguage[],
    handleJSONRefs = false,
): JSONInput<string> {
    if (typeof targetLanguage === "string") {
        targetLanguage = defined(languageNamed(targetLanguage, languages));
    }

    const compressedJSON = new CompressedJSONFromString(
        targetLanguage.dateTimeRecognizer,
        handleJSONRefs,
    );
    return new JSONInput(compressedJSON);
}

export class InputData {
    // FIXME: Make into a Map, indexed by kind.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _inputs: Set<Input<any>> = new Set();

    public addInput<T>(input: Input<T>): void {
        this._inputs = this._inputs.add(input);
    }

    private getOrAddInput<T>(
        kind: string,
        makeInput: () => Input<T>,
    ): Input<T> {
        let input: Input<T> | undefined = iterableFind(
            this._inputs,
            (i) => i.kind === kind,
        );
        if (input === undefined) {
            input = makeInput();
            this.addInput(input);
        }

        return input;
    }

    public async addSource<T>(
        kind: string,
        source: T,
        makeInput: () => Input<T>,
    ): Promise<void> {
        const input = this.getOrAddInput(kind, makeInput);
        await input.addSource(source);
    }

    public addSourceSync<T>(
        kind: string,
        source: T,
        makeInput: () => Input<T>,
    ): void {
        const input = this.getOrAddInput(kind, makeInput);
        input.addSourceSync(source);
    }

    public async addTypes(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean,
    ): Promise<void> {
        for (const input of this._inputs) {
            await input.addTypes(
                ctx,
                typeBuilder,
                inferMaps,
                inferEnums,
                fixedTopLevels,
            );
        }
    }

    public addTypesSync(
        ctx: RunContext,
        typeBuilder: TypeBuilder,
        inferMaps: boolean,
        inferEnums: boolean,
        fixedTopLevels: boolean,
    ): void {
        for (const input of this._inputs) {
            input.addTypesSync(
                ctx,
                typeBuilder,
                inferMaps,
                inferEnums,
                fixedTopLevels,
            );
        }
    }

    public get needIR(): boolean {
        return iterableSome(this._inputs, (i) => i.needIR);
    }

    public get needSchemaProcessing(): boolean {
        return iterableSome(this._inputs, (i) => i.needSchemaProcessing);
    }

    public singleStringSchemaSource(): string | undefined {
        const schemaStrings = setFilterMap(this._inputs, (i) =>
            i.singleStringSchemaSource(),
        );
        if (schemaStrings.size > 1) {
            return panic(
                "We have more than one input with a string schema source",
            );
        }

        return iterableFirst(schemaStrings);
    }
}

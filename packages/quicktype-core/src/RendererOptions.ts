// eslint-disable-next-line @typescript-eslint/no-redeclare
import { hasOwnProperty } from "collection-utils";

import { messageError } from "./Messages";
import { assert } from "./support/Support";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "./types";

/**
 * Primary options show up in the web UI in the "Language" settings tab,
 * secondary options in "Other".
 */
export type OptionKind = "primary" | "secondary";

export interface OptionDefinition {
    alias?: string;
    defaultOption?: boolean;
    defaultValue?: FixMeOptionsAnyType;
    description: string;
    kind?: OptionKind;
    legalValues?: string[];
    multiple?: boolean;
    name: string;
    renderer?: boolean;
    type: StringConstructor | BooleanConstructor;
    typeLabel?: string;
}

/**
 * The superclass for target language options.  You probably want to use one of its
 * subclasses, `BooleanOption`, `EnumOption`, or `StringOption`.
 */
export abstract class Option<T> {
    public readonly definition: OptionDefinition;

    public constructor(definition: OptionDefinition) {
        definition.renderer = true;
        this.definition = definition;
        assert(definition.kind !== undefined, "Renderer option kind must be defined");
    }

    public getValue(values: FixMeOptionsType): T {
        const value = values[this.definition.name];
        if (value === undefined) {
            return this.definition.defaultValue;
        }

        return value;
    }

    public get cliDefinitions(): { actual: OptionDefinition[]; display: OptionDefinition[] } {
        return { actual: [this.definition], display: [this.definition] };
    }
}

export type OptionValueType<O> = O extends Option<infer T> ? T : never;
export type OptionValues<T> = { [P in keyof T]: OptionValueType<T[P]> };

export function getOptionValues<T extends { [name: string]: Option<FixMeOptionsAnyType> }>(
    options: T,
    untypedOptionValues: FixMeOptionsType
): OptionValues<T> {
    const optionValues: FixMeOptionsType = {};
    for (const name of Object.getOwnPropertyNames(options)) {
        optionValues[name] = options[name].getValue(untypedOptionValues);
    }

    return optionValues as OptionValues<T>;
}

/**
 * A target language option that allows setting a boolean flag.
 */
export class BooleanOption extends Option<boolean> {
    /**
     * @param name The shorthand name.
     * @param description Short-ish description of the option.
     * @param defaultValue The default value.
     * @param kind Whether it's a primary or secondary option.
     */
    public constructor(name: string, description: string, defaultValue: boolean, kind: OptionKind = "primary") {
        super({
            name,
            kind,
            type: Boolean,
            description,
            defaultValue
        });
    }

    public get cliDefinitions(): { actual: OptionDefinition[]; display: OptionDefinition[] } {
        const negated = Object.assign({}, this.definition, {
            name: `no-${this.definition.name}`,
            defaultValue: !this.definition.defaultValue
        });
        const display = Object.assign({}, this.definition, {
            name: `[no-]${this.definition.name}`,
            description: `${this.definition.description} (${this.definition.defaultValue ? "on" : "off"} by default)`
        });
        return {
            display: [display],
            actual: [this.definition, negated]
        };
    }

    public getValue(values: FixMeOptionsType): boolean {
        let value = values[this.definition.name];
        if (value === undefined) {
            value = this.definition.defaultValue;
        }

        let negated = values[`no-${this.definition.name}`];
        if (negated === undefined) {
            negated = !this.definition.defaultValue;
        }

        if (value === "true") {
            value = true;
        } else if (value === "false") {
            value = false;
        }

        if (this.definition.defaultValue) {
            return value && !negated;
        } else {
            return value || !negated;
        }
    }
}

export class StringOption extends Option<string> {
    public constructor(
        name: string,
        description: string,
        typeLabel: string,
        defaultValue: string,
        kind: OptionKind = "primary"
    ) {
        const definition = {
            name,
            kind,
            type: String,
            description,
            typeLabel,
            defaultValue
        };
        super(definition);
    }
}

export class EnumOption<T> extends Option<T> {
    private readonly _values: { [name: string]: T };

    public constructor(
        name: string,
        description: string,
        values: Array<[string, T]>,
        defaultValue: string | undefined = undefined,
        kind: OptionKind = "primary"
    ) {
        if (defaultValue === undefined) {
            defaultValue = values[0][0];
        }

        const definition = {
            name,
            kind,
            type: String,
            description,
            typeLabel: values.map(([n, _]) => n).join("|"),
            legalValues: values.map(([n, _]) => n),
            defaultValue
        };
        super(definition);

        this._values = {};
        for (const [n, v] of values) {
            this._values[n] = v;
        }
    }

    public getValue(values: FixMeOptionsType): T {
        let name: string = values[this.definition.name];
        if (name === undefined) {
            name = this.definition.defaultValue;
        }

        if (!hasOwnProperty(this._values, name)) {
            return messageError("RendererUnknownOptionValue", { value: name, name: this.definition.name });
        }

        return this._values[name];
    }
}

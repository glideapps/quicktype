import { messageError } from "./Messages";
import { assert } from "./support/Support";
import { type FixMeOptionsType } from "./types";

/**
 * Primary options show up in the web UI in the "Language" settings tab,
 * secondary options in "Other".
 */
export type OptionKind = "primary" | "secondary";

export interface OptionDefinition<Name extends string, T> {
    alias?: string;
    defaultOption?: boolean;
    defaultValue?: T;
    description: string;
    kind?: OptionKind;
    legalValues?: string[];
    multiple?: boolean;
    name: Name;
    renderer?: boolean;
    type: StringConstructor | BooleanConstructor;
    typeLabel?: string;
}

/**
 * The superclass for target language options.  You probably want to use one of its
 * subclasses, `BooleanOption`, `EnumOption`, or `StringOption`.
 */
export abstract class Option<Name extends string, T> {
    public readonly definition: OptionDefinition<Name, T>;

    public constructor(definition: OptionDefinition<Name, T>) {
        definition.renderer = true;
        this.definition = definition;
        assert(definition.kind !== undefined, "Renderer option kind must be defined");
    }

    public get name(): Name {
        return this.definition.name;
    }

    public getValue(values: Record<string, unknown>): T {
        return (values[this.name] ?? this.definition.defaultValue) as T;
    }

    public get cliDefinitions(): {
        actual: Array<OptionDefinition<Name, T>>;
        display: Array<OptionDefinition<Name, T>>;
    } {
        return { actual: [this.definition], display: [this.definition] };
    }
}

export type OptionKey<O> = O extends Option<infer Name, unknown> ? Name : never;
export type OptionValue<O> =
    O extends EnumOption<string, infer EnumMap, infer EnumKey>
        ? EnumMap[EnumKey]
        : O extends Option<string, infer Value>
          ? Value
          : never;

// FIXME: Merge these and use camelCase user-facing keys (v24)
export type OptionMap<T> = { [K in keyof T as OptionKey<T[K]>]: OptionValue<T[K]> }; // user-facing, keys are `name` property of Option
export type OptionValues<T> = { [K in keyof T]: OptionValue<T[K]> }; // internal, keys are keys of `_Options` object in each language file

export function getOptionValues<Name extends string, T, Options extends Record<string, Option<Name, T>>>(
    options: Options,
    untypedOptionValues: FixMeOptionsType
): OptionValues<Options> {
    const optionValues: FixMeOptionsType = {};
    for (const name of Object.keys(options)) {
        const option = options[name];
        const value = option.getValue(untypedOptionValues);
        if (option instanceof EnumOption) {
            optionValues[name] = option.getEnumValue(value as string);
        } else {
            optionValues[name] = value;
        }
    }

    return optionValues as OptionValues<Options>;
}

/**
 * A target language option that allows setting a boolean flag.
 */
export class BooleanOption<Name extends string> extends Option<Name, boolean> {
    /**
     * @param name The shorthand name.
     * @param description Short-ish description of the option.
     * @param defaultValue The default value.
     * @param kind Whether it's a primary or secondary option.
     */
    public constructor(name: Name, description: string, defaultValue: boolean, kind: OptionKind = "primary") {
        super({
            name,
            kind,
            type: Boolean,
            description,
            defaultValue
        });
    }

    public get cliDefinitions(): {
        actual: Array<OptionDefinition<Name, boolean>>;
        display: Array<OptionDefinition<Name, boolean>>;
    } {
        const negated = Object.assign({}, this.definition, {
            name: `no-${this.name}`,
            defaultValue: !this.definition.defaultValue
        });
        const display = Object.assign({}, this.definition, {
            name: `[no-]${this.name}`,
            description: `${this.definition.description} (${this.definition.defaultValue ? "on" : "off"} by default)`
        });
        return {
            display: [display],
            actual: [this.definition, negated]
        };
    }

    public getValue(values: Record<string, unknown>): boolean {
        let value = values[this.name];
        if (value === undefined) {
            value = this.definition.defaultValue;
        }

        let negated = values[`no-${this.name}`];
        if (negated === undefined) {
            negated = !this.definition.defaultValue;
        }

        if (value === "true") {
            value = true;
        } else if (value === "false") {
            value = false;
        }

        if (this.definition.defaultValue) {
            return (value && !negated) as boolean;
        } else {
            return (value || !negated) as boolean;
        }
    }
}

export class StringOption<Name extends string> extends Option<Name, string> {
    public constructor(
        name: Name,
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

// FIXME: use const generics here
export class EnumOption<
    Name extends string,
    EnumMap extends Record<string, unknown>,
    EnumKey extends Extract<keyof EnumMap, string> = Extract<keyof EnumMap, string>
> extends Option<Name, EnumKey> {
    private readonly _values: EnumMap;

    public constructor(
        name: Name,
        description: string,
        values: EnumMap,
        defaultValue?: NoInfer<EnumKey>,
        kind: OptionKind = "primary"
    ) {
        const definition = {
            name,
            kind,
            type: String,
            description,
            typeLabel: Object.keys(values).join("|"),
            defaultValue
        };
        super(definition);

        this._values = values;
    }

    public getEnumValue<Key extends EnumKey>(name: Key): EnumMap[Key] {
        if (!(name in this._values)) {
            return messageError("RendererUnknownOptionValue", { value: name, name: this.name });
        }

        return this._values[name];
    }
}

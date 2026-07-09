import { messageError } from "../Messages";
import { assert } from "../support/Support";
import type { LanguageName, RendererOptions } from "../types";

import type { OptionDefinition, OptionKind, OptionValues } from "./types";

export * from "./types";

/**
 * The superclass for target language options.  You probably want to use one of its
 * subclasses, `BooleanOption`, `EnumOption`, or `StringOption`.
 */
export abstract class Option<Name extends string, T> {
    public readonly definition: OptionDefinition<Name, T>;

    public constructor(definition: OptionDefinition<Name, T>) {
        this.definition = definition;
        assert(
            definition.kind !== undefined,
            "Renderer option kind must be defined",
        );
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

export function getOptionValues<
    const Options extends Record<string, Option<string, unknown>>,
    Lang extends LanguageName,
>(
    options: Options,
    untypedOptionValues: RendererOptions<Lang>,
): OptionValues<Options> {
    const optionValues: Record<string, unknown> = {};

    for (const [key, option] of Object.entries(options)) {
        const value = option.getValue(untypedOptionValues);
        if (option instanceof EnumOption) {
            optionValues[key] = option.getEnumValue(value as string);
        } else {
            optionValues[key] = value;
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
    public constructor(
        name: Name,
        description: string,
        defaultValue: boolean,
        kind: OptionKind = "primary",
    ) {
        super({
            name,
            kind,
            optionType: "boolean",
            description,
            defaultValue,
        });
    }

    public get cliDefinitions(): {
        actual: Array<OptionDefinition<Name, boolean>>;
        display: Array<OptionDefinition<Name, boolean>>;
    } {
        const negated = Object.assign({}, this.definition, {
            name: `no-${this.name}`,
            defaultValue: !this.definition.defaultValue,
        });
        const display = Object.assign({}, this.definition, {
            name: `[no-]${this.name}`,
            description: `${this.definition.description} (${this.definition.defaultValue ? "on" : "off"} by default)`,
        });
        return {
            display: [display],
            actual: [this.definition, negated],
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
        }

        return (value || !negated) as boolean;
    }
}

export class StringOption<Name extends string> extends Option<Name, string> {
    public constructor(
        name: Name,
        description: string,
        typeLabel: string,
        defaultValue: string,
        kind: OptionKind = "primary",
    ) {
        super({
            name,
            kind,
            optionType: "string",
            description,
            typeLabel,
            defaultValue,
        });
    }
}

export class EnumOption<
    Name extends string,
    const EnumMap extends Record<string, unknown>,
    EnumKey extends Extract<keyof EnumMap, string> = Extract<
        keyof EnumMap,
        string
    >,
> extends Option<Name, EnumKey> {
    private readonly _values: EnumMap;

    public constructor(
        name: Name,
        description: string,
        values: EnumMap,
        defaultValue: NoInfer<EnumKey>,
        kind: OptionKind = "primary",
    ) {
        super({
            name,
            kind,
            optionType: "enum",
            description,
            typeLabel: Object.keys(values).join("|"),
            defaultValue,
            values,
        });

        this._values = values;
    }

    public getEnumValue<const Key extends EnumKey>(name: Key): EnumMap[Key] {
        if (!name) {
            const defaultKey = this.definition.defaultValue as NonNullable<Key>;
            return this._values[defaultKey];
        }

        if (!(name in this._values)) {
            return messageError("RendererUnknownOptionValue", {
                value: name,
                name: this.name,
            });
        }

        return this._values[name];
    }
}

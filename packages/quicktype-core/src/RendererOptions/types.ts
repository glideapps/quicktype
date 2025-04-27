import type { EnumOption, Option } from "./index";

/**
 * Primary options show up in the web UI in the "Language" settings tab,
 * secondary options in "Other".
 */
export type OptionKind = "primary" | "secondary";

export interface OptionDefinition<Name extends string = string, T = unknown> {
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

export type OptionName<O> = O extends Option<infer Name, unknown> ? Name : never;
export type OptionValue<O> =
    O extends EnumOption<string, infer EnumMap, infer EnumKey>
        ? EnumMap[EnumKey]
        : O extends Option<string, infer Value>
          ? Value
          : never;

export type OptionKey<O> = O extends EnumOption<string, Record<string, unknown>, infer EnumKey> ? EnumKey : O;

// FIXME: Merge these and use camelCase user-facing keys (v24)
export type OptionMap<T> = { [K in keyof T as OptionName<T[K]>]: OptionKey<T[K]> }; // user-facing, keys are `name` property of Option, values are the available input type
export type OptionValues<T> = { [K in keyof T]: OptionValue<T[K]> }; // internal, keys are keys of `_Options` object in each language file

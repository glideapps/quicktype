/**
 * Primary options show up in the web UI in the "Language" settings tab,
 * secondary options in "Other".
 */
export declare type OptionKind = "primary" | "secondary";
export interface OptionDefinition {
    name: string;
    type: StringConstructor | BooleanConstructor;
    kind?: OptionKind;
    renderer?: boolean;
    alias?: string;
    multiple?: boolean;
    defaultOption?: boolean;
    defaultValue?: any;
    typeLabel?: string;
    description: string;
    legalValues?: string[];
}
/**
 * The superclass for target language options.  You probably want to use one of its
 * subclasses, `BooleanOption`, `EnumOption`, or `StringOption`.
 */
export declare abstract class Option<T> {
    readonly definition: OptionDefinition;
    constructor(definition: OptionDefinition);
    getValue(values: {
        [name: string]: any;
    }): T;
    readonly cliDefinitions: {
        display: OptionDefinition[];
        actual: OptionDefinition[];
    };
}
export declare type OptionValueType<O> = O extends Option<infer T> ? T : never;
export declare type OptionValues<T> = {
    [P in keyof T]: OptionValueType<T[P]>;
};
export declare function getOptionValues<T extends {
    [name: string]: Option<any>;
}>(options: T, untypedOptionValues: {
    [name: string]: any;
}): OptionValues<T>;
/**
 * A target language option that allows setting a boolean flag.
 */
export declare class BooleanOption extends Option<boolean> {
    /**
     * @param name The shorthand name.
     * @param description Short-ish description of the option.
     * @param defaultValue The default value.
     * @param kind Whether it's a primary or secondary option.
     */
    constructor(name: string, description: string, defaultValue: boolean, kind?: OptionKind);
    readonly cliDefinitions: {
        display: OptionDefinition[];
        actual: OptionDefinition[];
    };
    getValue(values: {
        [name: string]: any;
    }): boolean;
}
export declare class StringOption extends Option<string> {
    constructor(name: string, description: string, typeLabel: string, defaultValue: string, kind?: OptionKind);
}
export declare class EnumOption<T> extends Option<T> {
    private readonly _values;
    constructor(name: string, description: string, values: [string, T][], defaultValue?: string | undefined, kind?: OptionKind);
    getValue(values: {
        [name: string]: any;
    }): T;
}

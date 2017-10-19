"use strict";

export interface OptionDefinition {
    name: string;
    type: any; // FIXME: this doesn't seem correct
    renderer?: boolean;
    alias?: string;
    multiple?: boolean;
    defaultOption?: boolean;
    defaultValue?: any;
    typeLabel?: string;
    description: string;
}

export abstract class UntypedOption {
    readonly definition: OptionDefinition;

    constructor(definition: OptionDefinition) {
        definition.renderer = true;
        this.definition = definition;
    }
}

export abstract class Option<T> extends UntypedOption {
    getValue(values: { [name: string]: any }): T {
        const value = values[this.definition.name];
        if (value === undefined) {
            return this.definition.defaultValue;
        }
        return value;
    }
}

export class BooleanOption extends Option<boolean> {
    constructor(name: string, description: string, defaultValue: boolean) {
        const definition = {
            name,
            type: Boolean,
            description,
            defaultValue
        };
        super(definition);
    }
}

export class StringOption extends Option<string> {
    constructor(name: string, description: string, typeLabel: string, defaultValue: string) {
        const definition = {
            name,
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

    constructor(name: string, description: string, values: [string, T][]) {
        const definition = {
            name,
            type: String,
            description,
            typeLabel: values.map(([n, _]) => n).join("|"),
            defaultValue: values[0][0]
        };
        super(definition);

        this._values = {};
        for (const [n, v] of values) {
            this._values[n] = v;
        }
    }

    getValue(values: { [name: string]: any }): T {
        let name: string = values[this.definition.name];
        if (name === undefined) {
            name = this.definition.defaultValue;
        }
        const value = this._values[name];
        if (value === undefined) {
            throw "Unknown option value.";
        }
        return value;
    }
}

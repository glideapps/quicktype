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

export abstract class RendererOption {
    readonly definition: OptionDefinition;

    constructor(definition: OptionDefinition) {
        definition.renderer = true;
        this.definition = definition;
    }
}

export abstract class TypedRendererOption<T> extends RendererOption {
    getValue(values: { [name: string]: any }): T {
        const value = values[this.definition.name];
        if (value === undefined) {
            return this.definition.defaultValue;
        }
        return value;
    }
}

export class BooleanRendererOption extends TypedRendererOption<boolean> {
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

export class StringRendererOption extends TypedRendererOption<string> {
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

export class EnumRendererOption<T> extends TypedRendererOption<T> {
    private readonly values: { [name: string]: T };

    constructor(name: string, description: string, values: [string, T][]) {
        const definition = {
            name,
            type: String,
            description,
            typeLabel: values.map(([n, _]) => n).join("|"),
            defaultValue: values[0][0]
        };
        super(definition);

        this.values = {};
        for (const [n, v] of values) {
            this.values[n] = v;
        }
    }

    getValue(values: { [name: string]: any }): T {
        const name: string = values[this.definition.name];
        if (name === undefined) {
            return this.definition.defaultValue;
        }
        const value = this.values[name];
        if (value === undefined) {
            throw "Unknown option value.";
        }
        return value;
    }
}

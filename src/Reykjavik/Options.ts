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

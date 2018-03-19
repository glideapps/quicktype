"use strict";

import { panic } from "./Support";

export interface OptionDefinition {
    name: string;
    type: StringConstructor | BooleanConstructor;
    renderer?: boolean;
    alias?: string;
    multiple?: boolean;
    defaultOption?: boolean;
    defaultValue?: any;
    typeLabel?: string;
    description: string;
    legalValues?: string[];
}

export abstract class UntypedOption {
    readonly definition: OptionDefinition;

    constructor(definition: OptionDefinition) {
        definition.renderer = true;
        this.definition = definition;
    }

    get cliDefinitions(): { display: OptionDefinition[]; actual: OptionDefinition[] } {
        return { actual: [this.definition], display: [this.definition] };
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
        super({
            name,
            type: Boolean,
            description,
            defaultValue
        });
    }

    get cliDefinitions(): { display: OptionDefinition[]; actual: OptionDefinition[] } {
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

    getValue(values: { [name: string]: any }): boolean {
        let value = values[this.definition.name];
        if (value === undefined) {
            value = this.definition.defaultValue;
        }

        let negated = values[`no-${this.definition.name}`];
        if (negated === undefined) {
            negated = !this.definition.defaultValue;
        }

        if (this.definition.defaultValue) {
            return value && !negated;
        } else {
            return value || !negated;
        }
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
            legalValues: values.map(([n, _]) => n),
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
            return panic(`Unknown value for option ${name}`);
        }
        return value;
    }
}

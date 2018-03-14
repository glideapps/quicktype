"use strict";

import { panic, assert } from "./Support";

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

    get cliDefinition(): OptionDefinition {
        return this.definition;
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
    constructor(name: string, description: string, defaultValue: boolean, private readonly _cliDescription?: string) {
        super({
            name,
            type: Boolean,
            description,
            defaultValue
        });
        if (defaultValue === true) {
            assert(_cliDescription !== undefined, "We need a CLI description for boolean options that are true by default");
        }
    }

    get cliDefinition(): OptionDefinition {
        const definition = Object.assign({}, this.definition);
        if (this._cliDescription !== undefined) {
            definition.description = this._cliDescription;
        }
        if (this.definition.defaultValue === true) {
            definition.name = `no-${definition.name}`;
        }
        definition.defaultValue = false;
        return definition;
    }

    getValue(values: { [name: string]: any }): boolean {
        const definition = this.cliDefinition;
        const value = values[definition.name];
        if (value === undefined) {
            return this.definition.defaultValue;
        }
        if (this.definition.defaultValue === true) {
            return !value;
        }
        return value;
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

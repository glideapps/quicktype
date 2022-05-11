"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Support_1 = require("./support/Support");
const Messages_1 = require("./Messages");
const collection_utils_1 = require("collection-utils");
/**
 * The superclass for target language options.  You probably want to use one of its
 * subclasses, `BooleanOption`, `EnumOption`, or `StringOption`.
 */
class Option {
    constructor(definition) {
        definition.renderer = true;
        this.definition = definition;
        Support_1.assert(definition.kind !== undefined, "Renderer option kind must be defined");
    }
    getValue(values) {
        const value = values[this.definition.name];
        if (value === undefined) {
            return this.definition.defaultValue;
        }
        return value;
    }
    get cliDefinitions() {
        return { actual: [this.definition], display: [this.definition] };
    }
}
exports.Option = Option;
function getOptionValues(options, untypedOptionValues) {
    const optionValues = {};
    for (const name of Object.getOwnPropertyNames(options)) {
        optionValues[name] = options[name].getValue(untypedOptionValues);
    }
    return optionValues;
}
exports.getOptionValues = getOptionValues;
/**
 * A target language option that allows setting a boolean flag.
 */
class BooleanOption extends Option {
    /**
     * @param name The shorthand name.
     * @param description Short-ish description of the option.
     * @param defaultValue The default value.
     * @param kind Whether it's a primary or secondary option.
     */
    constructor(name, description, defaultValue, kind = "primary") {
        super({
            name,
            kind,
            type: Boolean,
            description,
            defaultValue
        });
    }
    get cliDefinitions() {
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
    getValue(values) {
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
        }
        else if (value === "false") {
            value = false;
        }
        if (this.definition.defaultValue) {
            return value && !negated;
        }
        else {
            return value || !negated;
        }
    }
}
exports.BooleanOption = BooleanOption;
class StringOption extends Option {
    constructor(name, description, typeLabel, defaultValue, kind = "primary") {
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
exports.StringOption = StringOption;
class EnumOption extends Option {
    constructor(name, description, values, defaultValue = undefined, kind = "primary") {
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
    getValue(values) {
        let name = values[this.definition.name];
        if (name === undefined) {
            name = this.definition.defaultValue;
        }
        if (!collection_utils_1.hasOwnProperty(this._values, name)) {
            return Messages_1.messageError("RendererUnknownOptionValue", { value: name, name: this.definition.name });
        }
        return this._values[name];
    }
}
exports.EnumOption = EnumOption;

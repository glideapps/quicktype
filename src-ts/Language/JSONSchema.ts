"use strict";

import { Map, Collection } from "immutable";

import { TypeScriptTargetLanguage } from "../TargetLanguage";
import { Type, TopLevels, NamedType, UnionType, matchType, ClassType } from "../Type";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Namer, funPrefixNamer } from "../Naming";
import { legalizeCharacters, pascalCase, defined, assert } from "../Support";

export default class JSONSchemaTargetLanguage extends TypeScriptTargetLanguage {
    constructor() {
        super("JSON Schema", ["schema", "json-schema"], "schema", []);
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new JSONSchemaRenderer(topLevels);
        return renderer.render();
    }
}

const namingFunction = funPrefixNamer(jsonNameStyle);

const legalizeName = legalizeCharacters(cp => cp >= 32 && cp < 128 && cp !== 0x2f /* slash */);

function jsonNameStyle(original: string): string {
    const legalized = legalizeName(original);
    return pascalCase(legalized);
}

type Schema = { [name: string]: any };

class JSONSchemaRenderer extends ConvenienceRenderer {
    protected topLevelNameStyle(rawName: string): string {
        return jsonNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return namingFunction;
    }

    protected get propertyNamer(): null {
        return null;
    }

    protected get caseNamer(): null {
        return null;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    protected unionNeedsName(u: UnionType): boolean {
        return false;
    }

    private nameForType = (t: NamedType): string => {
        return defined(this.names.get(this.nameForNamedType(t)));
    };

    private makeOneOf = (types: Collection<any, Type>): Schema => {
        const count = types.count();
        assert(count > 0, "Must have at least one type for oneOf");
        if (count === 1) {
            return this.schemaForType(defined(types.first()));
        }
        return { oneOf: types.map(this.schemaForType).toArray() };
    };

    private schemaForType = (t: Type): Schema => {
        return matchType<{ [name: string]: any }>(
            t,
            anyType => ({}),
            nullType => ({ type: "null" }),
            boolType => ({ type: "boolean" }),
            integerType => ({ type: "integer" }),
            doubleType => ({ type: "number" }),
            stringType => ({ type: "string" }),
            arrayType => ({ type: "array", items: this.schemaForType(arrayType.items) }),
            classType => ({ $ref: `#/definitions/${this.nameForType(classType)}` }),
            mapType => ({ type: "object", additionalProperties: this.schemaForType(mapType.values) }),
            enumType => ({ type: "string", enum: enumType.cases.toArray() }),
            unionType => this.makeOneOf(unionType.sortedMembers)
        );
    };

    private definitionForClass = (c: ClassType): Schema => {
        const properties: Schema = {};
        const required: string[] = [];
        c.properties.forEach((t, name) => {
            properties[name] = this.schemaForType(t);
            if (!t.isNullable) {
                required.push(name);
            }
        });
        return {
            type: "object",
            additionalProperties: false,
            properties,
            required: required.sort(),
            title: c.combinedName
        };
    };

    protected emitSourceStructure(): void {
        // FIXME: Find a better way to do multiple top-levels.  Maybe multiple files?
        const schema = this.makeOneOf(this.topLevels);
        const definitions: { [name: string]: Schema } = {};
        this.forEachClass("none", (c, name) => {
            definitions[defined(this.names.get(name))] = this.definitionForClass(c);
        });
        schema.definitions = definitions;

        this.emitMultiline(JSON.stringify(schema, undefined, "    "));
    }
}

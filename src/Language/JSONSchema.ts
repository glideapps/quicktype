"use strict";

import { Collection } from "immutable";

import { TargetLanguage } from "../TargetLanguage";
import { Type, NamedType, UnionType, ClassType, matchTypeExhaustive } from "../Type";
import { TypeGraph } from "../TypeGraph";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Namer, funPrefixNamer } from "../Naming";
import { legalizeCharacters, splitIntoWords, combineWords, firstUpperWordStyle, allUpperWordStyle } from "../Strings";
import { defined, assert } from "../Support";
import { StringTypeMapping } from "../TypeBuilder";

export default class JSONSchemaTargetLanguage extends TargetLanguage {
    constructor() {
        super("JSON Schema", ["schema", "json-schema"], "schema", []);
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date", time: "time", dateTime: "date-time" };
    }

    renderGraph(graph: TypeGraph, _optionValues: { [name: string]: any }): RenderResult {
        const renderer = new JSONSchemaRenderer(graph);
        return renderer.render();
    }
}

const namingFunction = funPrefixNamer(jsonNameStyle);

const legalizeName = legalizeCharacters(cp => cp >= 32 && cp < 128 && cp !== 0x2f /* slash */);

function jsonNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        _ => true
    );
}

type Schema = { [name: string]: any };

class JSONSchemaRenderer extends ConvenienceRenderer {
    protected topLevelNameStyle(rawName: string): string {
        return jsonNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return namingFunction;
    }

    protected get classPropertyNamer(): null {
        return null;
    }

    protected get unionMemberNamer(): null {
        return null;
    }

    protected get enumCaseNamer(): null {
        return null;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    protected unionNeedsName(_: UnionType): boolean {
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
        return matchTypeExhaustive<{ [name: string]: any }>(
            t,
            _anyType => ({}),
            _nullType => ({ type: "null" }),
            _boolType => ({ type: "boolean" }),
            _integerType => ({ type: "integer" }),
            _doubleType => ({ type: "number" }),
            _stringType => ({ type: "string" }),
            arrayType => ({ type: "array", items: this.schemaForType(arrayType.items) }),
            classType => ({ $ref: `#/definitions/${this.nameForType(classType)}` }),
            mapType => ({ type: "object", additionalProperties: this.schemaForType(mapType.values) }),
            enumType => ({ type: "string", enum: enumType.cases.toArray(), title: enumType.combinedName }),
            unionType => {
                const schema = this.makeOneOf(unionType.sortedMembers);
                schema.title = unionType.combinedName;
                return schema;
            },
            _dateType => ({ type: "string", format: "date" }),
            _timeType => ({ type: "string", format: "time" }),
            _dateTimeType => ({ type: "string", format: "date-time" })
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

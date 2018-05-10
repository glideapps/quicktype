import { Collection } from "immutable";

import { TargetLanguage } from "../TargetLanguage";
import { Type, UnionType, EnumType, ObjectType } from "../Type";
import { matchTypeExhaustive } from "../TypeUtils";
import { TypeGraph } from "../TypeGraph";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Namer, funPrefixNamer, Name } from "../Naming";
import { legalizeCharacters, splitIntoWords, combineWords, firstUpperWordStyle, allUpperWordStyle } from "../support/Strings";
import { defined, assert, panic } from "../support/Support";
import { StringTypeMapping } from "../TypeBuilder";
import { descriptionTypeAttributeKind } from "../TypeAttributes";
import { Option } from "../RendererOptions";

export default class JSONSchemaTargetLanguage extends TargetLanguage {
    constructor() {
        super("JSON Schema", ["schema", "json-schema"], "schema");
    }

    protected getOptions(): Option<any>[] {
        return [];
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date", time: "time", dateTime: "date-time" };
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsFullObjectType(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return JSONSchemaRenderer;
    }
}

const namingFunction = funPrefixNamer("namer", jsonNameStyle);

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

export class JSONSchemaRenderer extends ConvenienceRenderer {
    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForObjectProperty(): null {
        return null;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): null {
        return null;
    }

    private nameForType = (t: Type): string => {
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

    private makeRef(t: Type): Schema {
        return { $ref: `#/definitions/${this.nameForType(t)}` };
    }

    private addDescription(t: Type, schema: Schema): void {
        const description = this.typeGraph.attributeStore.tryGet(descriptionTypeAttributeKind, t);
        if (description !== undefined) {
            schema.description = description.join("\n");
        }
    }

    private schemaForType = (t: Type): Schema => {
        const schema = matchTypeExhaustive<{ [name: string]: any }>(
            t,
            _noneType => {
                return panic("None type should have been replaced");
            },
            _anyType => ({}),
            _nullType => ({ type: "null" }),
            _boolType => ({ type: "boolean" }),
            _integerType => ({ type: "integer" }),
            _doubleType => ({ type: "number" }),
            _stringType => ({ type: "string" }),
            arrayType => ({ type: "array", items: this.schemaForType(arrayType.items) }),
            classType => this.makeRef(classType),
            mapType => this.definitionForObject(mapType, undefined),
            objectType => this.makeRef(objectType),
            enumType => this.makeRef(enumType),
            unionType => {
                if (this.unionNeedsName(unionType)) {
                    return this.makeRef(unionType);
                } else {
                    return this.definitionForUnion(unionType);
                }
            },
            _dateType => ({ type: "string", format: "date" }),
            _timeType => ({ type: "string", format: "time" }),
            _dateTimeType => ({ type: "string", format: "date-time" })
        );
        if (schema.$ref === undefined) {
            this.addDescription(t, schema);
        }
        return schema;
    };

    private definitionForObject(o: ObjectType, title: string | undefined): Schema {
        let properties: Schema | undefined;
        let required: string[] | undefined;
        if (o.getProperties().isEmpty()) {
            properties = undefined;
            required = undefined;
        } else {
            const props: Schema = {};
            const req: string[] = [];
            o.getProperties().forEach((p, name) => {
                props[name] = this.schemaForType(p.type);
                if (!p.isOptional) {
                    req.push(name);
                }
            });
            properties = props;
            required = req.sort();
        }
        const additional = o.getAdditionalProperties();
        const additionalProperties = additional !== undefined ? this.schemaForType(additional) : false;
        const schema = {
            type: "object",
            additionalProperties,
            properties,
            required,
            title
        };
        this.addDescription(o, schema);
        return schema;
    }

    private definitionForUnion(u: UnionType, title?: string): Schema {
        const oneOf = this.makeOneOf(u.sortedMembers);
        if (title !== undefined) {
            oneOf.title = title;
        }
        this.addDescription(u, oneOf);
        return oneOf;
    }

    private definitionForEnum(e: EnumType, title: string): Schema {
        const schema = { type: "string", enum: e.cases.toArray(), title };
        this.addDescription(e, schema);
        return schema;
    }

    protected emitSourceStructure(): void {
        // FIXME: Find a better way to do multiple top-levels.  Maybe multiple files?
        const schema = Object.assign(
            { $schema: "http://json-schema.org/draft-06/schema#" },
            this.makeOneOf(this.topLevels.toList())
        );
        const definitions: { [name: string]: Schema } = {};
        this.forEachObject("none", (o: ObjectType, name: Name) => {
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForObject(o, title);
        });
        this.forEachUnion("none", (u, name) => {
            if (!this.unionNeedsName(u)) return;
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForUnion(u, title);
        });
        this.forEachEnum("none", (e, name) => {
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForEnum(e, title);
        });
        schema.definitions = definitions;

        this.emitMultiline(JSON.stringify(schema, undefined, "    "));
    }
}

import { arrayIntercalate, iterableSome } from "collection-utils";

import { type Name } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, modifySource } from "../../Source";
import { camelCase } from "../../support/Strings";
import { mustNotHappen } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import {
    type ArrayType,
    ClassType,
    type EnumType,
    type MapType,
    type PrimitiveType,
    type Type,
    UnionType
} from "../../Type";
import { matchType, nullableFromUnion } from "../../TypeUtils";

import { KotlinRenderer } from "./KotlinRenderer";
import { type kotlinOptions } from "./language";
import { stringEscape } from "./utils";

export class KotlinJacksonRenderer extends KotlinRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        _kotlinOptions: OptionValues<typeof kotlinOptions>
    ) {
        super(targetLanguage, renderContext, _kotlinOptions);
    }

    private unionMemberJsonValueGuard(t: Type, _e: Sourcelike): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "is Any",
            _nullType => "null",
            _boolType => "is BooleanNode",
            _integerType => "is IntNode, is LongNode",
            _doubleType => "is DoubleNode",
            _stringType => "is TextNode",
            _arrayType => "is ArrayNode",
            // These could be stricter, but for now we don't allow maps
            // and objects in the same union
            _classType => "is ObjectNode",
            _mapType => "is ObjectNode",
            // This could be stricter, but for now we don't allow strings
            // and enums in the same union
            _enumType => "is TextNode",
            _unionType => mustNotHappen()
        );
    }

    protected emitUsageHeader(): void {
        this.emitLine("// To parse the JSON, install jackson-module-kotlin and do:");
        this.emitLine("//");
        this.forEachTopLevel("none", (_, name) => {
            this.emitLine("//   val ", modifySource(camelCase, name), " = ", name, ".fromJson(jsonString)");
        });
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitMultiline(`import com.fasterxml.jackson.annotation.*
import com.fasterxml.jackson.core.*
import com.fasterxml.jackson.databind.*
import com.fasterxml.jackson.databind.deser.std.StdDeserializer
import com.fasterxml.jackson.databind.module.SimpleModule
import com.fasterxml.jackson.databind.node.*
import com.fasterxml.jackson.databind.ser.std.StdSerializer
import com.fasterxml.jackson.module.kotlin.*`);

        const hasUnions = iterableSome(
            this.typeGraph.allNamedTypes(),
            t => t instanceof UnionType && nullableFromUnion(t) === null
        );
        const hasEmptyObjects = iterableSome(
            this.typeGraph.allNamedTypes(),
            c => c instanceof ClassType && c.getProperties().size === 0
        );
        if (hasUnions || this.haveEnums || hasEmptyObjects) {
            this.emitGenericConverter();
        }

        let converters: Sourcelike[][] = [];
        // if (hasEmptyObjects) {
        //     converters.push([["convert(JsonNode::class,"], [" { it },"], [" { writeValueAsString(it) })"]]);
        // }
        this.forEachEnum("none", (_, name) => {
            converters.push([
                ["convert(", name, "::class,"],
                [" { ", name, ".fromValue(it.asText()) },"],
                [' { "\\"${it.value}\\"" })']
            ]);
        });
        this.forEachUnion("none", (_, name) => {
            converters.push([
                ["convert(", name, "::class,"],
                [" { ", name, ".fromJson(it) },"],
                [" { it.toJson() }, true)"]
            ]);
        });

        this.ensureBlankLine();
        this.emitLine("val mapper = jacksonObjectMapper().apply {");
        this.indent(() => {
            this.emitLine("propertyNamingStrategy = PropertyNamingStrategy.LOWER_CAMEL_CASE");
            this.emitLine("setSerializationInclusion(JsonInclude.Include.NON_NULL)");
        });

        if (converters.length > 0) {
            this.indent(() => this.emitTable(converters));
        }

        this.emitLine("}");
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitBlock(
            ["class ", name, "(elements: Collection<", elementType, ">) : ArrayList<", elementType, ">(elements)"],
            () => {
                this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine("fun fromJson(json: String) = mapper.readValue<", name, ">(json)");
                });
            }
        );
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.kotlinType(t.values);
        this.emitBlock(
            [
                "class ",
                name,
                "(elements: Map<String, ",
                elementType,
                ">) : HashMap<String, ",
                elementType,
                ">(elements)"
            ],
            () => {
                this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine("fun fromJson(json: String) = mapper.readValue<", name, ">(json)");
                });
            }
        );
    }

    private jacksonRenameAttribute(
        propName: Name,
        jsonName: string,
        required: boolean,
        ignore = false
    ): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        const properties: Sourcelike[] = [];
        const isPrefixBool = jsonName.startsWith("is"); // https://github.com/FasterXML/jackson-module-kotlin/issues/80
        const propertyOpts: Sourcelike[] = [];

        if (namesDiffer || isPrefixBool) {
            propertyOpts.push('"' + escapedName + '"');
        }

        if (required) {
            propertyOpts.push("required=true");
        }

        if (propertyOpts.length > 0) {
            properties.push(["@get:JsonProperty(", arrayIntercalate(", ", propertyOpts), ")"]);
            properties.push(["@field:JsonProperty(", arrayIntercalate(", ", propertyOpts), ")"]);
        }

        if (ignore) {
            properties.push("@get:JsonIgnore");
            properties.push("@field:JsonIgnore");
        }

        return properties.length === 0 ? undefined : properties;
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));

        this.emitLine("typealias ", className, " = JsonNode");
    }

    protected emitClassDefinitionMethods(c: ClassType, className: Name): void {
        const isTopLevel = iterableSome(this.topLevels, ([_, top]) => top === c);
        if (isTopLevel) {
            this.emitBlock(")", () => {
                this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine("fun fromJson(json: String) = mapper.readValue<", className, ">(json)");
                });
            });
        } else {
            this.emitLine(")");
        }
    }

    protected renameAttribute(name: Name, jsonName: string, required: boolean, meta: Array<() => void>): void {
        const rename = this.jacksonRenameAttribute(name, jsonName, required);
        if (rename !== undefined) {
            meta.push(() => this.emitLine(rename));
        }
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                this.emitLine(name, `("${stringEscape(json)}")`, --count === 0 ? ";" : ",");
            });
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitBlock(["fun fromValue(value: String): ", enumName, " = when (value)"], () => {
                    let table: Sourcelike[][] = [];
                    this.forEachEnumCase(e, "none", (name, json) => {
                        table.push([[`"${stringEscape(json)}"`], [" -> ", name]]);
                    });
                    table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                    this.emitTable(table);
                });
            });
        });
    }

    private emitGenericConverter(): void {
        this.ensureBlankLine();
        this.emitMultiline(`
@Suppress("UNCHECKED_CAST")
private fun <T> ObjectMapper.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonNode) -> T, toJson: (T) -> String, isUnion: Boolean = false) = registerModule(SimpleModule().apply {
	addSerializer(k.java as Class<T>, object : StdSerializer<T>(k.java as Class<T>) {
			override fun serialize(value: T, gen: JsonGenerator, provider: SerializerProvider) = gen.writeRawValue(toJson(value))
	})
	addDeserializer(k.java as Class<T>, object : StdDeserializer<T>(k.java as Class<T>) {
			override fun deserialize(p: JsonParser, ctxt: DeserializationContext) = fromJson(p.readValueAsTree())
	})
})`);
    }

    protected emitUnionDefinitionMethods(
        u: UnionType,
        nonNulls: ReadonlySet<Type>,
        maybeNull: PrimitiveType | null,
        unionName: Name
    ): void {
        this.ensureBlankLine();
        this.emitLine("fun toJson(): String = mapper.writeValueAsString(when (this) {");
        this.indent(() => {
            let toJsonTable: Sourcelike[][] = [];
            this.forEachUnionMember(u, nonNulls, "none", null, name => {
                toJsonTable.push([["is ", name], [" -> this.value"]]);
            });
            if (maybeNull !== null) {
                const name = this.nameForUnionMember(u, maybeNull);
                toJsonTable.push([["is ", name], [' -> "null"']]);
            }

            this.emitTable(toJsonTable);
        });
        this.emitLine("})");
        this.ensureBlankLine();
        this.emitBlock("companion object", () => {
            this.emitLine("fun fromJson(jn: JsonNode): ", unionName, " = when (jn) {");
            this.indent(() => {
                let table: Sourcelike[][] = [];
                this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                    table.push([[this.unionMemberJsonValueGuard(t, "jn")], [" -> ", name, "(mapper.treeToValue(jn))"]]);
                });
                if (maybeNull !== null) {
                    const name = this.nameForUnionMember(u, maybeNull);
                    table.push([[this.unionMemberJsonValueGuard(maybeNull, "jn")], [" -> ", name, "()"]]);
                }

                table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                this.emitTable(table);
            });
            this.emitLine("}");
        });
    }
}

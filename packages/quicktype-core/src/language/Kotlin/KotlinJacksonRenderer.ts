import { arrayIntercalate, iterableSome } from "collection-utils";

import {
    minMaxItemsForType,
    minMaxLengthForType,
    minMaxValueForType,
    patternForType,
} from "../../attributes/Constraints.js";
import type { Name } from "../../Naming.js";
import { type Sourcelike, modifySource } from "../../Source.js";
import { camelCase } from "../../support/Strings.js";
import { mustNotHappen } from "../../support/Support.js";
import {
    type ArrayType,
    type ClassProperty,
    ClassType,
    type EnumType,
    type MapType,
    type PrimitiveType,
    type Type,
    UnionType,
} from "../../Type/index.js";
import { matchType, nullableFromUnion } from "../../Type/TypeUtils.js";

import { KotlinRenderer } from "./KotlinRenderer.js";
import { stringEscape, unionMemberMatchPriority } from "./utils.js";

export class KotlinJacksonRenderer extends KotlinRenderer {
    protected propertyDefault(
        p: ClassProperty,
        _nullableOrOptional: boolean,
    ): Sourcelike {
        return p.isOptional || p.type.kind === "null" ? " = null" : "";
    }

    private unionMemberJsonValueGuard(t: Type, _e: Sourcelike): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => "is Any",
            (_nullType) => "is NullNode",
            (_boolType) => "is BooleanNode",
            (_integerType) => "is IntNode, is LongNode",
            (_doubleType) => "is IntNode, is LongNode, is DoubleNode",
            (_stringType) => "is TextNode",
            (_arrayType) => "is ArrayNode",
            // These could be stricter, but for now we don't allow maps
            // and objects in the same union
            (_classType) => "is ObjectNode",
            (_mapType) => "is ObjectNode",
            // This could be stricter, but for now we don't allow strings
            // and enums in the same union
            (_enumType) => "is TextNode",
            (_unionType) => mustNotHappen(),
            (_transformedStringType) => "is TextNode",
        );
    }

    protected emitUsageHeader(): void {
        this.emitLine(
            "// To parse the JSON, install jackson-module-kotlin and do:",
        );
        this.emitLine("//");
        this.forEachTopLevel("none", (_, name) => {
            this.emitLine(
                "//   val ",
                modifySource(camelCase, name),
                " = ",
                name,
                ".fromJson(jsonString)",
            );
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
            (t) => t instanceof UnionType && nullableFromUnion(t) === null,
        );
        const hasNullableUnions = iterableSome(
            this.typeGraph.allNamedTypes(),
            (t) =>
                t instanceof UnionType &&
                nullableFromUnion(t) === null &&
                t.isNullable,
        );
        const hasEmptyObjects = iterableSome(
            this.typeGraph.allNamedTypes(),
            (c) => c instanceof ClassType && c.getProperties().size === 0,
        );
        const usesDateTime = this.haveTransformedStringType("date-time");
        const usesDate = this.haveTransformedStringType("date");
        const usesTime = this.haveTransformedStringType("time");
        if (
            hasUnions ||
            this.haveEnums ||
            hasEmptyObjects ||
            usesDateTime ||
            usesDate ||
            usesTime
        ) {
            this.emitGenericConverter(hasNullableUnions);
        }

        const converters: Sourcelike[][] = [];
        // if (hasEmptyObjects) {
        //     converters.push([["convert(JsonNode::class,"], [" { it },"], [" { writeValueAsString(it) })"]]);
        // }
        // We don't use jackson-datatype-jsr310's JavaTimeModule because its
        // serializers don't round-trip faithfully (e.g. OffsetTime pads
        // "23:20:50.52Z" to "23:20:50.520Z"); the ISO formatters do.
        if (usesDateTime) {
            converters.push([
                ["convert(OffsetDateTime::class,"],
                [" { OffsetDateTime.parse(it.asText()) },"],
                [
                    ' { "\\"${java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(it)}\\"" })',
                ],
            ]);
        }

        if (usesDate) {
            converters.push([
                ["convert(LocalDate::class,"],
                [" { LocalDate.parse(it.asText()) },"],
                [
                    ' { "\\"${java.time.format.DateTimeFormatter.ISO_LOCAL_DATE.format(it)}\\"" })',
                ],
            ]);
        }

        if (usesTime) {
            converters.push([
                ["convert(OffsetTime::class,"],
                [" { OffsetTime.parse(it.asText()) },"],
                [
                    ' { "\\"${java.time.format.DateTimeFormatter.ISO_OFFSET_TIME.format(it)}\\"" })',
                ],
            ]);
        }

        this.forEachEnum("none", (_, name) => {
            converters.push([
                ["convert(", name, "::class,"],
                [" { ", name, ".fromValue(it.asText()) },"],
                [' { "\\"${it.value}\\"" })'],
            ]);
        });
        this.forEachUnion("none", (_, name) => {
            converters.push([
                ["convert(", name, "::class,"],
                [" { ", name, ".fromJson(it) },"],
                [" { it.toJson() }, true)"],
            ]);
        });

        this.ensureBlankLine();
        this.emitLine("val mapper = jacksonObjectMapper().apply {");
        this.indent(() => {
            this.emitLine(
                'propertyNamingStrategy = object : PropertyNamingStrategy.PropertyNamingStrategyBase() { override fun translate(name: String) = if (name == "empty") "" else name }',
            );
            this.emitLine(
                "setSerializationInclusion(JsonInclude.Include.NON_NULL)",
            );
            if (
                iterableSome(
                    this.typeGraph.allTypesUnordered(),
                    (t) => t.kind === "integer",
                )
            ) {
                this.emitLine(
                    "disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)",
                );
            }
        });

        if (converters.length > 0) {
            this.indent(() => this.emitTable(converters));
        }

        this.emitLine("}");
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitBlock(
            [
                "class ",
                name,
                "(elements: Collection<",
                elementType,
                "> = emptyList()) : ArrayList<",
                elementType,
                ">(elements)",
            ],
            () => {
                this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine(
                        "fun fromJson(json: String) = mapper.readValue<",
                        name,
                        ">(json)",
                    );
                });
            },
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
                ">(elements)",
            ],
            () => {
                this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine(
                        "fun fromJson(json: String) = mapper.readValue<",
                        name,
                        ">(json)",
                    );
                });
            },
        );
    }

    private jacksonRenameAttribute(
        propName: Name,
        jsonName: string,
        required: boolean,
        ignore = false,
    ): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        const properties: Sourcelike[] = [];
        const isPrefixBool = jsonName.startsWith("is"); // https://github.com/FasterXML/jackson-module-kotlin/issues/80
        const propertyOpts: Sourcelike[] = [];

        if (
            namesDiffer ||
            isPrefixBool ||
            jsonName === "empty" ||
            /^[a-z][A-Z]/.test(jsonName)
        ) {
            propertyOpts.push(`"${escapedName}"`);
        }

        if (required) {
            propertyOpts.push("required=true");
        }

        if (propertyOpts.length > 0) {
            properties.push([
                "@get:JsonProperty(",
                arrayIntercalate(", ", propertyOpts),
                ")",
            ]);
            properties.push([
                "@field:JsonProperty(",
                arrayIntercalate(", ", propertyOpts),
                ")",
            ]);
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
        const isTopLevel = iterableSome(
            this.topLevels,
            ([_, top]) => top === c,
        );
        if (isTopLevel) {
            this.emitBlock(")", () => {
                const checks: string[] = [];
                this.forEachClassProperty(c, "none", (name, _json, p) => {
                    const [min, max] = minMaxItemsForType(p.type) ?? [];
                    const n = this.sourcelikeToString(name);
                    const before = p.isOptional
                        ? `${n}?.let { require(it.size`
                        : `require(${n}.size`;
                    const after = p.isOptional ? ") }" : ")";
                    if (min !== undefined)
                        checks.push(`${before} >= ${min}${after}`);
                    if (max !== undefined)
                        checks.push(`${before} <= ${max}${after}`);
                    const [numberMin, numberMax] =
                        minMaxValueForType(p.type) ?? [];
                    const numberBefore = p.isOptional
                        ? `${n}?.let { require(it`
                        : `require(${n}`;
                    if (numberMin !== undefined)
                        checks.push(`${numberBefore} >= ${numberMin}${after}`);
                    if (numberMax !== undefined)
                        checks.push(`${numberBefore} <= ${numberMax}${after}`);
                    const [lengthMin, lengthMax] =
                        minMaxLengthForType(p.type) ?? [];
                    const lengthBefore = p.isOptional
                        ? `${n}?.let { require(it.length`
                        : `require(${n}.length`;
                    if (lengthMin !== undefined)
                        checks.push(`${lengthBefore} >= ${lengthMin}${after}`);
                    if (lengthMax !== undefined)
                        checks.push(`${lengthBefore} <= ${lengthMax}${after}`);
                    const pattern = patternForType(p.type);
                    if (pattern !== undefined) {
                        const regex = `Regex("${stringEscape(pattern)}").containsMatchIn`;
                        checks.push(
                            p.isOptional
                                ? `${n}?.let { require(${regex}(it)) }`
                                : `require(${regex}(${n}))`,
                        );
                    }
                });
                if (checks.length > 0)
                    this.emitBlock("init", () =>
                        checks.forEach((check) => {
                            this.emitLine(check);
                        }),
                    );
                this.emitLine("fun toJson() = mapper.writeValueAsString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine(
                        "fun fromJson(json: String) = mapper.readValue<",
                        className,
                        ">(json)",
                    );
                });
            });
        } else {
            this.emitLine(")");
        }
    }

    protected renameAttribute(
        name: Name,
        jsonName: string,
        required: boolean,
        meta: Array<() => void>,
    ): void {
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
                this.emitLine(
                    name,
                    `("${stringEscape(json)}")`,
                    --count === 0 ? ";" : ",",
                );
            });
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitBlock(
                    [
                        "fun fromValue(value: String): ",
                        enumName,
                        " = when (value)",
                    ],
                    () => {
                        const table: Sourcelike[][] = [];
                        this.forEachEnumCase(e, "none", (name, json) => {
                            table.push([
                                [`"${stringEscape(json)}"`],
                                [" -> ", name],
                            ]);
                        });
                        table.push([
                            ["else"],
                            [" -> throw IllegalArgumentException()"],
                        ]);
                        this.emitTable(table);
                    },
                );
            });
        });
    }

    private emitGenericConverter(hasNullableUnions: boolean): void {
        this.ensureBlankLine();
        this.emitMultiline(`
@Suppress("UNCHECKED_CAST")
private fun <T> ObjectMapper.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonNode) -> T, toJson: (T) -> String, isUnion: Boolean = false) = registerModule(SimpleModule().apply {
	addSerializer(k.java as Class<T>, object : StdSerializer<T>(k.java as Class<T>) {
			override fun serialize(value: T, gen: JsonGenerator, provider: SerializerProvider) = gen.writeRawValue(toJson(value))
	})
	addDeserializer(k.java as Class<T>, object : StdDeserializer<T>(k.java as Class<T>) {
			override fun deserialize(p: JsonParser, ctxt: DeserializationContext) = fromJson(p.readValueAsTree())${hasNullableUnions ? "\n\t\t\toverride fun getNullValue(ctxt: DeserializationContext) = if (isUnion) fromJson(NullNode.instance) else null" : ""}
	})
})`);
    }

    protected emitUnionDefinitionMethods(
        u: UnionType,
        nonNulls: ReadonlySet<Type>,
        maybeNull: PrimitiveType | null,
        unionName: Name,
    ): void {
        this.ensureBlankLine();
        this.emitLine(
            "fun toJson(): String = mapper.writeValueAsString(when (this) {",
        );
        this.indent(() => {
            const toJsonTable: Sourcelike[][] = [];
            this.forEachUnionMember(u, nonNulls, "none", null, (name) => {
                toJsonTable.push([["is ", name], [" -> this.value"]]);
            });
            if (maybeNull !== null) {
                const name = this.nameForUnionMember(u, maybeNull);
                toJsonTable.push([["is ", name], [" -> null"]]);
            }

            this.emitTable(toJsonTable);
        });
        this.emitLine("})");
        this.ensureBlankLine();
        this.emitBlock("companion object", () => {
            this.emitLine(
                "fun fromJson(jn: JsonNode): ",
                unionName,
                " = when (jn) {",
            );
            this.indent(() => {
                // Members whose JSON representations share a node type
                // (several transformed string types, or a transformed string
                // type and an enum, are all TextNode) must share a single
                // guard and be tried in sequence, most specific parse first.
                const groups: Array<{
                    guard: string;
                    members: Array<{ name: Name; t: Type }>;
                }> = [];
                this.forEachUnionMember(
                    u,
                    nonNulls,
                    "none",
                    null,
                    (name, t) => {
                        const guard = this.sourcelikeToString(
                            this.unionMemberJsonValueGuard(t, "jn"),
                        );
                        const group = groups.find((g) => g.guard === guard);
                        if (group === undefined) {
                            groups.push({ guard, members: [{ name, t }] });
                        } else {
                            group.members.push({ name, t });
                        }
                    },
                );
                const table: Sourcelike[][] = [];
                for (const { guard, members } of groups) {
                    const ordered = [...members].sort(
                        (a, b) =>
                            unionMemberMatchPriority(a.t) -
                            unionMemberMatchPriority(b.t),
                    );
                    let expr: Sourcelike = [
                        ordered[ordered.length - 1].name,
                        "(mapper.convertValue(jn))",
                    ];
                    for (let i = ordered.length - 2; i >= 0; i--) {
                        expr = [
                            "try { ",
                            ordered[i].name,
                            "(mapper.convertValue(jn)) } catch (e: Exception) { ",
                            expr,
                            " }",
                        ];
                    }

                    table.push([[guard], [" -> ", expr]]);
                }

                if (maybeNull !== null) {
                    const name = this.nameForUnionMember(u, maybeNull);
                    table.push([
                        [this.unionMemberJsonValueGuard(maybeNull, "jn")],
                        [" -> ", name, "()"],
                    ]);
                }

                table.push([
                    ["else"],
                    [" -> throw IllegalArgumentException()"],
                ]);
                this.emitTable(table);
            });
            this.emitLine("}");
        });
    }
}

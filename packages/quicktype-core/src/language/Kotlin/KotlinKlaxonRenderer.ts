import { arrayIntercalate, iterableSome } from "collection-utils";

import type { Name } from "../../Naming.js";
import { type Sourcelike, modifySource } from "../../Source.js";
import { camelCase } from "../../support/Strings.js";
import { mustNotHappen } from "../../support/Support.js";
import {
    type ArrayType,
    type ClassProperty,
    ClassType,
    type EnumType,
    MapType,
    type PrimitiveType,
    type Type,
    UnionType,
} from "../../Type/index.js";
import { matchType, nullableFromUnion } from "../../Type/TypeUtils.js";

import { KotlinRenderer } from "./KotlinRenderer.js";
import { stringEscape, unionMemberMatchPriority } from "./utils.js";

export class KotlinKlaxonRenderer extends KotlinRenderer {
    private unionMemberFromJsonValue(t: Type, e: Sourcelike): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => [e, ".inside"],
            (_nullType) => "null",
            (_boolType) => [e, ".boolean"],
            (_integerType) => ["(", e, ".int?.toLong() ?: ", e, ".longValue)"],
            (_doubleType) => [e, ".double"],
            (_stringType) => [e, ".string"],
            (arrayType) => [
                e,
                ".array?.let { klaxon.parseFromJsonArray<",
                this.kotlinType(arrayType.items),
                ">(it) }",
            ],
            (_classType) => [
                e,
                ".obj?.let { klaxon.parseFromJsonObject<",
                this.kotlinType(t),
                ">(it) }",
            ],
            (_mapType) => [
                e,
                ".obj?.let { klaxon.parseFromJsonObject<",
                this.kotlinType(t),
                ">(it) }",
            ],
            (enumType) => [
                e,
                ".string?.let { ",
                this.kotlinType(enumType),
                ".fromValue(it) }",
            ],
            (_unionType) => mustNotHappen(),
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    return [e, ".string?.let { OffsetDateTime.parse(it) }"];
                }

                if (transformedStringType.kind === "date") {
                    return [e, ".string?.let { LocalDate.parse(it) }"];
                }

                if (transformedStringType.kind === "time") {
                    return [e, ".string?.let { OffsetTime.parse(it) }"];
                }

                return [e, ".string"];
            },
        );
    }

    private unionMemberJsonValueGuard(t: Type, _e: Sourcelike): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => "is Any",
            (_nullType) => "null",
            (_boolType) => "is Boolean",
            (_integerType) => "is Int, is Long",
            (_doubleType) => "is Double",
            (_stringType) => "is String",
            (_arrayType) => "is JsonArray<*>",
            // These could be stricter, but for now we don't allow maps
            // and objects in the same union
            (_classType) => "is JsonObject",
            (_mapType) => "is JsonObject",
            // This could be stricter, but for now we don't allow strings
            // and enums in the same union
            (_enumType) => "is String",
            (_unionType) => mustNotHappen(),
            (_transformedStringType) => "is String",
        );
    }

    // Empty object types render as a typealias for JsonObject.  Klaxon's
    // reflective deserializer never consults custom converters for map
    // values, so a `Map<String, JsonObject>` property fails to parse:
    // https://github.com/glideapps/quicktype/issues/2881
    // Properties holding such maps (directly or nested inside other maps)
    // are annotated so that a field-level converter — which Klaxon does
    // consult — handles them instead.
    private isEmptyObjectType(t: Type): boolean {
        if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            return nullable !== null && this.isEmptyObjectType(nullable);
        }

        return t instanceof ClassType && t.getProperties().size === 0;
    }

    private needsJsonObjectMapAnnotation(t: Type): boolean {
        if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            return (
                nullable !== null && this.needsJsonObjectMapAnnotation(nullable)
            );
        }

        if (!(t instanceof MapType)) {
            return false;
        }

        return (
            this.isEmptyObjectType(t.values) ||
            this.needsJsonObjectMapAnnotation(t.values)
        );
    }

    private hasJsonObjectMaps(): boolean {
        return iterableSome(
            this.typeGraph.allNamedTypes(),
            (t) =>
                t instanceof ClassType &&
                iterableSome(t.getProperties().values(), (p) =>
                    this.needsJsonObjectMapAnnotation(p.type),
                ),
        );
    }

    protected emitUsageHeader(): void {
        this.emitLine("// To parse the JSON, install Klaxon and do:");
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

        this.emitLine("import com.beust.klaxon.*");

        const hasUnions = iterableSome(
            this.typeGraph.allNamedTypes(),
            (t) => t instanceof UnionType && nullableFromUnion(t) === null,
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
            this.emitGenericConverter();
        }

        const hasJsonObjectMaps = this.hasJsonObjectMaps();
        if (hasJsonObjectMaps) {
            this.emitJsonObjectMapConverter();
        }

        const converters: Sourcelike[][] = [];
        if (usesDateTime) {
            converters.push([
                [".convert(OffsetDateTime::class,"],
                [" { OffsetDateTime.parse(it.string!!) },"],
                [
                    ' { "\\"${java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(it)}\\"" })',
                ],
            ]);
        }

        if (usesDate) {
            converters.push([
                [".convert(LocalDate::class,"],
                [" { LocalDate.parse(it.string!!) },"],
                [
                    ' { "\\"${java.time.format.DateTimeFormatter.ISO_LOCAL_DATE.format(it)}\\"" })',
                ],
            ]);
        }

        if (usesTime) {
            converters.push([
                [".convert(OffsetTime::class,"],
                [" { OffsetTime.parse(it.string!!) },"],
                [
                    ' { "\\"${java.time.format.DateTimeFormatter.ISO_OFFSET_TIME.format(it)}\\"" })',
                ],
            ]);
        }

        if (hasEmptyObjects) {
            converters.push([
                [".convert(JsonObject::class,"],
                [" { it.obj!! },"],
                [" { it.toJsonString() })"],
            ]);
        }

        this.forEachEnum("none", (_, name) => {
            converters.push([
                [".convert(", name, "::class,"],
                [" { ", name, ".fromValue(it.string!!) },"],
                [' { "\\"${it.value}\\"" })'],
            ]);
        });
        this.forEachUnion("none", (_, name) => {
            converters.push([
                [".convert(", name, "::class,"],
                [" { ", name, ".fromJson(it) },"],
                [" { it.toJson() }, true)"],
            ]);
        });

        this.ensureBlankLine();
        this.emitLine("private val klaxon = Klaxon()");
        if (converters.length > 0) {
            this.indent(() => this.emitTable(converters));
        }

        if (hasJsonObjectMaps) {
            this.indent(() =>
                this.emitLine(
                    ".fieldConverter(KlaxonJsonObjectMap::class, jsonObjectMapConverter)",
                ),
            );
        }
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitBlock(
            [
                "class ",
                name,
                "(elements: Collection<",
                elementType,
                ">) : ArrayList<",
                elementType,
                ">(elements)",
            ],
            () => {
                this.emitLine(
                    "public fun toJson() = klaxon.toJsonString(this)",
                );
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine(
                        "public fun fromJson(json: String) = ",
                        name,
                        "(klaxon.parseArray<",
                        elementType,
                        ">(json)!!)",
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
                this.emitLine(
                    "public fun toJson() = klaxon.toJsonString(this)",
                );
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitBlock(
                        ["public fun fromJson(json: String) = ", name],
                        () => {
                            this.emitLine(
                                "klaxon.parseJsonObject(java.io.StringReader(json)) as Map<String, ",
                                elementType,
                                ">",
                            );
                        },
                        "paren",
                    );
                });
            },
        );
    }

    private klaxonRenameAttribute(
        propName: Name,
        jsonName: string,
        ignore = false,
    ): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        const properties: Sourcelike[] = [];
        if (namesDiffer) {
            properties.push(['name = "', escapedName, '"']);
        }

        if (ignore) {
            properties.push("ignored = true");
        }

        return properties.length === 0
            ? undefined
            : ["@Json(", arrayIntercalate(", ", properties), ")"];
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));

        this.emitLine("typealias ", className, " = JsonObject");
    }

    protected emitClassDefinitionMethods(c: ClassType, className: Name): void {
        const isTopLevel = iterableSome(
            this.topLevels,
            ([_, top]) => top === c,
        );
        if (isTopLevel) {
            this.emitBlock(")", () => {
                this.emitLine(
                    "public fun toJson() = klaxon.toJsonString(this)",
                );
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine(
                        "public fun fromJson(json: String) = klaxon.parse<",
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
        _required: boolean,
        meta: Array<() => void>,
        p: ClassProperty,
    ): void {
        if (this.needsJsonObjectMapAnnotation(p.type)) {
            meta.push(() => this.emitLine("@KlaxonJsonObjectMap"));
        }

        const rename = this.klaxonRenameAttribute(name, jsonName);
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
                        "public fun fromValue(value: String): ",
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

    private emitGenericConverter(): void {
        this.ensureBlankLine();
        this.emitLine(
            "private fun <T> Klaxon.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonValue) -> T, toJson: (T) -> String, isUnion: Boolean = false) =",
        );
        this.indent(() => {
            this.emitLine("this.converter(object: Converter {");
            this.indent(() => {
                this.emitLine('@Suppress("UNCHECKED_CAST")');
                this.emitTable([
                    [
                        "override fun toJson(value: Any)",
                        " = toJson(value as T)",
                    ],
                    [
                        "override fun fromJson(jv: JsonValue)",
                        " = fromJson(jv) as Any",
                    ],
                    [
                        "override fun canConvert(cls: Class<*>)",
                        " = cls == k.java || (isUnion && cls.superclass == k.java)",
                    ],
                ]);
            });
            this.emitLine("})");
        });
    }

    private emitJsonObjectMapConverter(): void {
        this.ensureBlankLine();
        this.emitLine(
            "// Klaxon cannot deserialize map values typed as JsonObject, so fields",
        );
        this.emitLine(
            "// holding such maps are converted at the field level instead.",
        );
        this.emitLine("@Target(AnnotationTarget.FIELD)");
        this.emitLine("private annotation class KlaxonJsonObjectMap");
        this.ensureBlankLine();
        this.emitLine(
            "private val jsonObjectMapConverter: Converter = object : Converter {",
        );
        this.indent(() => {
            this.emitTable([
                ["override fun canConvert(cls: Class<*>)", " = true"],
                ["override fun fromJson(jv: JsonValue)", " = jv.obj!!"],
                [
                    "override fun toJson(value: Any)",
                    " = klaxon.toJsonString(value)",
                ],
            ]);
        });
        this.emitLine("}");
    }

    protected emitUnionDefinitionMethods(
        u: UnionType,
        nonNulls: ReadonlySet<Type>,
        maybeNull: PrimitiveType | null,
        unionName: Name,
    ): void {
        this.ensureBlankLine();
        this.emitLine(
            "public fun toJson(): String = klaxon.toJsonString(when (this) {",
        );
        this.indent(() => {
            const toJsonTable: Sourcelike[][] = [];
            this.forEachUnionMember(u, nonNulls, "none", null, (name) => {
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
            this.emitLine(
                "public fun fromJson(jv: JsonValue): ",
                unionName,
                " = when (jv.inside) {",
            );
            this.indent(() => {
                // Members whose JSON representations share a value type
                // (several transformed string types, or a transformed string
                // type and an enum, are all strings) must share a single
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
                            this.unionMemberJsonValueGuard(t, "jv.inside"),
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
                    const last = ordered[ordered.length - 1];
                    let expr: Sourcelike = [
                        last.name,
                        "(",
                        this.unionMemberFromJsonValue(last.t, "jv"),
                        "!!)",
                    ];
                    for (let i = ordered.length - 2; i >= 0; i--) {
                        expr = [
                            "try { ",
                            ordered[i].name,
                            "(",
                            this.unionMemberFromJsonValue(ordered[i].t, "jv"),
                            "!!) } catch (e: Exception) { ",
                            expr,
                            " }",
                        ];
                    }

                    table.push([[guard], [" -> ", expr]]);
                }

                if (maybeNull !== null) {
                    const name = this.nameForUnionMember(u, maybeNull);
                    table.push([
                        [
                            this.unionMemberJsonValueGuard(
                                maybeNull,
                                "jv.inside",
                            ),
                        ],
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

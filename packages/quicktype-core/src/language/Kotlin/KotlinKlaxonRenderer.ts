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
import { matchType, nullableFromUnion } from "../../Type/TypeUtils";

import { KotlinRenderer } from "./KotlinRenderer";
import { type kotlinOptions } from "./language";
import { stringEscape } from "./utils";

export class KotlinKlaxonRenderer extends KotlinRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        _kotlinOptions: OptionValues<typeof kotlinOptions>
    ) {
        super(targetLanguage, renderContext, _kotlinOptions);
    }

    private unionMemberFromJsonValue(t: Type, e: Sourcelike): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => [e, ".inside"],
            _nullType => "null",
            _boolType => [e, ".boolean"],
            _integerType => ["(", e, ".int?.toLong() ?: ", e, ".longValue)"],
            _doubleType => [e, ".double"],
            _stringType => [e, ".string"],
            arrayType => [e, ".array?.let { klaxon.parseFromJsonArray<", this.kotlinType(arrayType.items), ">(it) }"],
            _classType => [e, ".obj?.let { klaxon.parseFromJsonObject<", this.kotlinType(t), ">(it) }"],
            _mapType => [e, ".obj?.let { klaxon.parseFromJsonObject<", this.kotlinType(t), ">(it) }"],
            enumType => [e, ".string?.let { ", this.kotlinType(enumType), ".fromValue(it) }"],
            _unionType => mustNotHappen()
        );
    }

    private unionMemberJsonValueGuard(t: Type, _e: Sourcelike): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "is Any",
            _nullType => "null",
            _boolType => "is Boolean",
            _integerType => "is Int, is Long",
            _doubleType => "is Double",
            _stringType => "is String",
            _arrayType => "is JsonArray<*>",
            // These could be stricter, but for now we don't allow maps
            // and objects in the same union
            _classType => "is JsonObject",
            _mapType => "is JsonObject",
            // This could be stricter, but for now we don't allow strings
            // and enums in the same union
            _enumType => "is String",
            _unionType => mustNotHappen()
        );
    }

    protected emitUsageHeader(): void {
        this.emitLine("// To parse the JSON, install Klaxon and do:");
        this.emitLine("//");
        this.forEachTopLevel("none", (_, name) => {
            this.emitLine("//   val ", modifySource(camelCase, name), " = ", name, ".fromJson(jsonString)");
        });
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import com.beust.klaxon.*");

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
        if (hasEmptyObjects) {
            converters.push([[".convert(JsonObject::class,"], [" { it.obj!! },"], [" { it.toJsonString() })"]]);
        }

        this.forEachEnum("none", (_, name) => {
            converters.push([
                [".convert(", name, "::class,"],
                [" { ", name, ".fromValue(it.string!!) },"],
                [' { "\\"${it.value}\\"" })']
            ]);
        });
        this.forEachUnion("none", (_, name) => {
            converters.push([
                [".convert(", name, "::class,"],
                [" { ", name, ".fromJson(it) },"],
                [" { it.toJson() }, true)"]
            ]);
        });

        this.ensureBlankLine();
        this.emitLine("private val klaxon = Klaxon()");
        if (converters.length > 0) {
            this.indent(() => this.emitTable(converters));
        }
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitBlock(
            ["class ", name, "(elements: Collection<", elementType, ">) : ArrayList<", elementType, ">(elements)"],
            () => {
                this.emitLine("public fun toJson() = klaxon.toJsonString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine(
                        "public fun fromJson(json: String) = ",
                        name,
                        "(klaxon.parseArray<",
                        elementType,
                        ">(json)!!)"
                    );
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
                this.emitLine("public fun toJson() = klaxon.toJsonString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitBlock(
                        ["public fun fromJson(json: String) = ", name],
                        () => {
                            this.emitLine(
                                "klaxon.parseJsonObject(java.io.StringReader(json)) as Map<String, ",
                                elementType,
                                ">"
                            );
                        },
                        "paren"
                    );
                });
            }
        );
    }

    private klaxonRenameAttribute(propName: Name, jsonName: string, ignore = false): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        const properties: Sourcelike[] = [];
        if (namesDiffer) {
            properties.push(['name = "', escapedName, '"']);
        }

        if (ignore) {
            properties.push("ignored = true");
        }

        return properties.length === 0 ? undefined : ["@Json(", arrayIntercalate(", ", properties), ")"];
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));

        this.emitLine("typealias ", className, " = JsonObject");
    }

    protected emitClassDefinitionMethods(c: ClassType, className: Name): void {
        const isTopLevel = iterableSome(this.topLevels, ([_, top]) => top === c);
        if (isTopLevel) {
            this.emitBlock(")", () => {
                this.emitLine("public fun toJson() = klaxon.toJsonString(this)");
                this.ensureBlankLine();
                this.emitBlock("companion object", () => {
                    this.emitLine("public fun fromJson(json: String) = klaxon.parse<", className, ">(json)");
                });
            });
        } else {
            this.emitLine(")");
        }
    }

    protected renameAttribute(name: Name, jsonName: string, _required: boolean, meta: Array<() => void>): void {
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
                this.emitLine(name, `("${stringEscape(json)}")`, --count === 0 ? ";" : ",");
            });
            this.ensureBlankLine();
            this.emitBlock("companion object", () => {
                this.emitBlock(["public fun fromValue(value: String): ", enumName, " = when (value)"], () => {
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
        this.emitLine(
            "private fun <T> Klaxon.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonValue) -> T, toJson: (T) -> String, isUnion: Boolean = false) ="
        );
        this.indent(() => {
            this.emitLine("this.converter(object: Converter {");
            this.indent(() => {
                this.emitLine('@Suppress("UNCHECKED_CAST")');
                this.emitTable([
                    ["override fun toJson(value: Any)", " = toJson(value as T)"],
                    ["override fun fromJson(jv: JsonValue)", " = fromJson(jv) as Any"],
                    [
                        "override fun canConvert(cls: Class<*>)",
                        " = cls == k.java || (isUnion && cls.superclass == k.java)"
                    ]
                ]);
            });
            this.emitLine("})");
        });
    }

    protected emitUnionDefinitionMethods(
        u: UnionType,
        nonNulls: ReadonlySet<Type>,
        maybeNull: PrimitiveType | null,
        unionName: Name
    ): void {
        this.ensureBlankLine();
        this.emitLine("public fun toJson(): String = klaxon.toJsonString(when (this) {");
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
            this.emitLine("public fun fromJson(jv: JsonValue): ", unionName, " = when (jv.inside) {");
            this.indent(() => {
                let table: Sourcelike[][] = [];
                this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                    table.push([
                        [this.unionMemberJsonValueGuard(t, "jv.inside")],
                        [" -> ", name, "(", this.unionMemberFromJsonValue(t, "jv"), "!!)"]
                    ]);
                });
                if (maybeNull !== null) {
                    const name = this.nameForUnionMember(u, maybeNull);
                    table.push([[this.unionMemberJsonValueGuard(maybeNull, "jv.inside")], [" -> ", name, "()"]]);
                }

                table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                this.emitTable(table);
            });
            this.emitLine("}");
        });
    }
}

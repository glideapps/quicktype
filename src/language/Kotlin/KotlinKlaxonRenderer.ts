import { KotlinRenderer } from ".";

import { Name } from "../../Naming";
import { Sourcelike } from "../../Source";
import { mustNotHappen } from "../../Support";
import { TargetLanguage } from "../../TargetLanguage";
import { ClassType, Type, UnionType, PrimitiveType, MapType, ArrayType } from "../../Type";
import { TypeGraph } from "../../TypeGraph";
import { matchType, nullableFromUnion } from "../../TypeUtils";
import { OrderedSet } from "immutable";

export class KotlinKlaxonRenderer extends KotlinRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        _package: string
    ) {
        super(targetLanguage, graph, leadingComments, _package);
    }

    protected frameworkName(): string | undefined {
        return "Klaxon";
    }

    protected frameworkForbiddenNames(): string[] {
        return super.frameworkForbiddenNames().concat(["JsonObject", "JsonValue", "Converter", "Klaxon"]);
    }

    protected frameworkImports(): string[] {
        return super.frameworkImports().concat(["com.beust.klaxon.*"]);
    }

    private emitGenericConverter(): void {
        this.ensureBlankLine();
        this.emitLine(
            "private fun <T> Klaxon.convert(k: kotlin.reflect.KClass<*>, fromJson: (JsonValue) -> T, toJson: (T) -> String, isUnion: Boolean = false) ="
        );
        this.indent(() => {
            this.emitLine("this.converter(object: Converter {");
            this.indent(() => {
                this.emitLine(`@Suppress("UNCHECKED_CAST")`);
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

    protected emitFrameworkPreface(): void {
        const hasUnions = this.typeGraph
            .allNamedTypes()
            .some(t => t instanceof UnionType && nullableFromUnion(t) === null);
        const hasEmptyObjects = this.typeGraph
            .allNamedTypes()
            .some(c => c instanceof ClassType && c.getProperties().isEmpty());
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

    protected emitEmptyClassDefinition(className: Name): void {
        this.emitLine("typealias ", className, " = JsonObject");
    }

    protected emitClassBody(className: Name): void {
        this.emitLine("public fun toJson() = klaxon.toJsonString(this)");
        this.ensureBlankLine();
        this.emitBlock("companion object", () => {
            this.emitLine("public fun fromJson(json: String) = klaxon.parse<", className, ">(json)");
        });
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

    protected emitUnionBody(
        u: UnionType,
        unionName: Name,
        maybeNull: PrimitiveType | null,
        nonNulls: OrderedSet<Type>
    ): void {
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

    protected emitTopLevelArrayBody(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
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

    protected emitTopLevelMapBody(t: MapType, name: Name): void {
        const elementType = this.kotlinType(t.values);
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
}

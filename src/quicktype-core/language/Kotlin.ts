import { iterableSome, arrayIntercalate } from "collection-utils";

import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { EnumOption, Option, StringOption, OptionValues, getOptionValues } from "../RendererOptions";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    camelCase,
    combineWords,
    escapeNonPrintableMapper,
    firstUpperWordStyle,
    intToHex,
    isDigit,
    isLetterOrUnderscore,
    isNumeric,
    isPrintable,
    legalizeCharacters,
    splitIntoWords,
    utf32ConcatMap
} from "../support/Strings";
import { assertNever, mustNotHappen } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import {
    ArrayType,
    ClassProperty,
    ClassType,
    EnumType,
    MapType,
    ObjectType,
    PrimitiveType,
    Type,
    UnionType
} from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { RenderContext } from "../Renderer";

export enum Framework {
    None,
    Jackson,
    Klaxon,
    KotlinX,
    Gson
}

export const kotlinOptions = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        [["just-types", Framework.None], ["jackson", Framework.Jackson], ["klaxon", Framework.Klaxon], ["kotlinx", Framework.KotlinX], ["gson", Framework.Gson]],
        "klaxon"
    ),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype")
};

export class KotlinTargetLanguage extends TargetLanguage {
    constructor() {
        super("Kotlin", ["kotlin"], "kt");
    }

    protected getOptions(): Option<any>[] {
        return [kotlinOptions.framework, kotlinOptions.packageName];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): ConvenienceRenderer {
        const options = getOptionValues(kotlinOptions, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new KotlinRenderer(this, renderContext, options);
            case Framework.Jackson:
                return new KotlinJacksonRenderer(this, renderContext, options);
            case Framework.Klaxon:
                return new KotlinKlaxonRenderer(this, renderContext, options);
            case Framework.KotlinX:
                return new KotlinXRenderer(this, renderContext, options);
            case Framework.Gson:
                return new KotlinGsonRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}

const keywords = [
    "package",
    "as",
    "typealias",
    "class",
    "this",
    "super",
    "val",
    "var",
    "fun",
    "for",
    "null",
    "true",
    "false",
    "is",
    "in",
    "throw",
    "return",
    "break",
    "continue",
    "object",
    "if",
    "try",
    "else",
    "while",
    "do",
    "when",
    "interface",
    "typeof",
    "klaxon",
    "toJson",
    "Any",
    "Boolean",
    "Double",
    "Float",
    "Long",
    "Int",
    "Short",
    "System",
    "Byte",
    "String",
    "Array",
    "List",
    "Map",
    "Enum",
    "Class",
    "JsonObject",
    "JsonValue",
    "Converter",
    "Klaxon"
];

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function kotlinNameStyle(isUpper: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function unicodeEscape(codePoint: number): string {
    return "\\u" + intToHex(codePoint, 4);
}

const _stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

function stringEscape(s: string): string {
    // "$this" is a template string in Kotlin so we have to escape $
    return _stringEscape(s).replace(/\$/g, "\\$");
}

const upperNamingFunction = funPrefixNamer("upper", s => kotlinNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer("lower", s => kotlinNameStyle(false, s));

export class KotlinRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _kotlinOptions: OptionValues<typeof kotlinOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_o: ObjectType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected topLevelNameStyle(rawName: string): string {
        return kotlinNameStyle(true, rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return lowerNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer("upper", s => kotlinNameStyle(true, s) + "Value");
    }

    protected makeEnumCaseNamer(): Namer {
        return upperNamingFunction;
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, f: () => void, delimiter: "curly" | "paren" | "lambda" = "curly"): void {
        const [open, close] = delimiter === "curly" ? ["{", "}"] : delimiter === "paren" ? ["(", ")"] : ["{", "})"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }

    protected anySourceType(optional: string): Sourcelike {
        return ["Any", optional];
    }

    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    protected arrayType(arrayType: ArrayType, withIssues: boolean = false, _noOptional: boolean = false): Sourcelike {
        return ["List<", this.kotlinType(arrayType.items, withIssues), ">"];
    }

    protected mapType(mapType: MapType, withIssues: boolean = false, _noOptional: boolean = false): Sourcelike {
        return ["Map<String, ", this.kotlinType(mapType.values, withIssues), ">"];
    }

    protected kotlinType(t: Type, withIssues: boolean = false, noOptional: boolean = false): Sourcelike {
        const optional = noOptional ? "" : "?";
        return matchType<Sourcelike>(
            t,
            _anyType => {
                return maybeAnnotated(withIssues, anyTypeIssueAnnotation, this.anySourceType(optional));
            },
            _nullType => {
                return maybeAnnotated(withIssues, nullTypeIssueAnnotation, this.anySourceType(optional));
            },
            _boolType => "Boolean",
            _integerType => "Long",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => this.arrayType(arrayType, withIssues),
            classType => this.nameForNamedType(classType),
            mapType => this.mapType(mapType, withIssues),
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return [this.kotlinType(nullable, withIssues), optional];
                return this.nameForNamedType(unionType);
            }
        );
    }

    protected emitUsageHeader(): void {
        // To be overridden
    }

    protected emitHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitUsageHeader();
        }

        this.ensureBlankLine();
        this.emitLine("package ", this._kotlinOptions.packageName);
        this.ensureBlankLine();
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitLine(["typealias ", name, " = ArrayList<", elementType, ">"]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.kotlinType(t.values);
        this.emitLine(["typealias ", name, " = HashMap<String, ", elementType, ">"]);
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitClassAnnotations(c, className);
        this.emitLine("class ", className, "()");
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }

        const kotlinType = (p: ClassProperty) => {
            if (p.isOptional) {
                return [this.kotlinType(p.type, true, true), "?"];
            } else {
                return this.kotlinType(p.type, true);
            }
        };

        this.emitDescription(this.descriptionForType(c));
        this.emitClassAnnotations(c, className);
        this.emitLine("data class ", className, " (");
        this.indent(() => {
            let count = c.getProperties().size;
            let first = true;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const nullable = p.type.kind === "union" && nullableFromUnion(p.type as UnionType) !== null;
                const nullableOrOptional = p.isOptional || p.type.kind === "null" || nullable;
                const last = --count === 0;
                let meta: Array<() => void> = [];

                const description = this.descriptionForClassProperty(c, jsonName);
                if (description !== undefined) {
                    meta.push(() => this.emitDescription(description));
                }

                this.renameAttribute(name, jsonName, !nullableOrOptional, meta);

                if (meta.length > 0 && !first) {
                    this.ensureBlankLine();
                }

                for (const emit of meta) {
                    emit();
                }

                this.emitLine("val ", name, ": ", kotlinType(p), nullableOrOptional ? " = null" : "", last ? "" : ",");

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });

        this.emitClassDefinitionMethods(c, className);
    }

    protected emitClassDefinitionMethods(_c: ClassType, _className: Name) {
        this.emitLine(")");
    }

    protected emitClassAnnotations(_c: Type, _className: Name) {
        // to be overridden
    }

    protected renameAttribute(_name: Name, _jsonName: string, _required: boolean, _meta: Array<() => void>) {
        // to be overridden
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(["enum class ", enumName], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", name => {
                this.emitLine(name, --count === 0 ? "" : ",");
            });
        });
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        this.emitClassAnnotations(u, unionName);
        this.emitBlock(["sealed class ", unionName], () => {
            {
                let table: Sourcelike[][] = [];
                this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                    table.push([["class ", name, "(val value: ", this.kotlinType(t), ")"], [" : ", unionName, "()"]]);
                });
                if (maybeNull !== null) {
                    table.push([["class ", this.nameForUnionMember(u, maybeNull), "()"], [" : ", unionName, "()"]]);
                }
                this.emitTable(table);
            }

            this.emitUnionDefinitionMethods(u, nonNulls, maybeNull, unionName);
        });
    }

    protected emitUnionDefinitionMethods(
        _u: UnionType,
        _nonNulls: ReadonlySet<Type>,
        _maybeNull: PrimitiveType | null,
        _unionName: Name
    ) {
        // to be overridden
    }

    protected emitSourceStructure(): void {
        this.emitHeader();

        // Top-level arrays, maps
        this.forEachTopLevel("leading", (t, name) => {
            if (t instanceof ArrayType) {
                this.emitTopLevelArray(t, name);
            } else if (t instanceof MapType) {
                this.emitTopLevelMap(t, name);
            }
        });

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n)
        );
    }
}

export class KotlinKlaxonRenderer extends KotlinRenderer {
    constructor(
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

    private klaxonRenameAttribute(propName: Name, jsonName: string, ignore: boolean = false): Sourcelike | undefined {
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

    protected emitClassDefinitionMethods(c: ClassType, className: Name) {
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

    protected renameAttribute(name: Name, jsonName: string, _required: boolean, meta: Array<() => void>) {
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

    protected emitUnionDefinitionMethods(
        u: UnionType,
        nonNulls: ReadonlySet<Type>,
        maybeNull: PrimitiveType | null,
        unionName: Name
    ) {
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

export class KotlinJacksonRenderer extends KotlinRenderer {
    constructor(
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
        ignore: boolean = false
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

    protected emitClassDefinitionMethods(c: ClassType, className: Name) {
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

    protected renameAttribute(name: Name, jsonName: string, required: boolean, meta: Array<() => void>) {
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
    ) {
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

/**
 * Currently supports simple classes, enums, and TS string unions (which are also enums).
 * TODO: Union, Any, Top Level Array, Top Level Map
 */
export class KotlinXRenderer extends KotlinRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        _kotlinOptions: OptionValues<typeof kotlinOptions>
    ) {
        super(targetLanguage, renderContext, _kotlinOptions);
    }

    protected anySourceType(optional: string): Sourcelike {
        return ["JsonObject", optional];
    }

    protected arrayType(arrayType: ArrayType, withIssues: boolean = false, noOptional: boolean = false): Sourcelike {
        const valType = this.kotlinType(arrayType.items, withIssues, true);
        const name = this.sourcelikeToString(valType);
        if (name === "JsonObject") {
            return "JsonArray";
        }
        return super.arrayType(arrayType, withIssues, noOptional);
    }

    protected mapType(mapType: MapType, withIssues: boolean = false, noOptional: boolean = false): Sourcelike {
        const valType = this.kotlinType(mapType.values, withIssues, true);
        const name = this.sourcelikeToString(valType);
        if (name === "JsonObject") {
            return "JsonObject";
        }
        return super.mapType(mapType, withIssues, noOptional);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.kotlinType(t.values);
        if (elementType === "JsonObject") {
            this.emitLine(["typealias ", name, " = JsonObject"]);
        } else {
            super.emitTopLevelMap(t, name);
        }
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        this.emitLine(["typealias ", name, " = JsonArray<", elementType, ">"]);
    }

    protected emitUsageHeader(): void {
        this.emitLine("// To parse the JSON, install kotlin's serialization plugin and do:");
        this.emitLine("//");
        const table: Sourcelike[][] = [];
        table.push(["// val ", "json", " = Json { allowStructuredMapKeys = true }"]);
        this.forEachTopLevel("none", (_, name) => {
            table.push(["// val ", modifySource(camelCase, name), ` = json.parse(${this.sourcelikeToString(name)}.serializer(), jsonString)`]);
        });
        this.emitTable(table);
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import kotlinx.serialization.*");
        this.emitLine("import kotlinx.serialization.json.*");
        this.emitLine("import kotlinx.serialization.descriptors.*");
        this.emitLine("import kotlinx.serialization.encoding.*");
    }

    protected emitClassAnnotations(_c: Type, _className: Name) {
        this.emitLine("@Serializable");
    }

    protected renameAttribute(name: Name, jsonName: string, _required: boolean, meta: Array<() => void>) {
        const rename = this._rename(name, jsonName);
        if (rename !== undefined) {
            meta.push(() => this.emitLine(rename));
        }
    }

    private _rename(propName: Name, jsonName: string): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer) {
            return ["@SerialName(\"", escapedName, "\")"];
        }
        return undefined;
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitLine(["@Serializable(with = ", enumName, ".Companion::class)"]);
        this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                this.emitLine(name, `("${stringEscape(json)}")`, --count === 0 ? ";" : ",");
            });
            this.ensureBlankLine();
            this.emitBlock(["companion object : KSerializer<", enumName, ">"], () => {
                this.emitBlock("override val descriptor: SerialDescriptor get()", () => {
                    this.emitLine("return PrimitiveSerialDescriptor(\"", this._kotlinOptions.packageName, ".", enumName, "\", PrimitiveKind.STRING)");
                });

                this.emitBlock(["override fun deserialize(decoder: Decoder): ", enumName, " = when (val value = decoder.decodeString())"], () => {
                    let table: Sourcelike[][] = [];
                    this.forEachEnumCase(e, "none", (name, json) => {
                        table.push([[`"${stringEscape(json)}"`], [" -> ", name]]);
                    });
                    table.push([["else"], [" -> throw IllegalArgumentException(\"", enumName, " could not parse: $value\")"]]);
                    this.emitTable(table);
                });

                this.emitBlock(["override fun serialize(encoder: Encoder, value: ", enumName, ")"], () => {
                    this.emitLine(["return encoder.encodeString(value.value)"]);
                });
            });
        });
    }
}

export class KotlinGsonRenderer extends KotlinRenderer {
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext, _kotlinOptions: OptionValues<typeof kotlinOptions>) {
        super(targetLanguage, renderContext, _kotlinOptions)
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import com.google.gson.*");
        this.emitLine("import com.google.gson.annotations.*");
    }

    protected renameAttribute(name: Name, jsonName: string, _required: boolean, meta: Array<() => void>) {
        const rename = this._rename(name, jsonName);
        meta.push(() => this.emitLine(rename));
    }

    private _rename(_: Name, jsonName: string): Sourcelike {
        const escapedName = stringEscape(jsonName);
        return ["@SerializedName(\"", escapedName, "\")"];
    }

    protected emitUsageHeader(): void {
        this.emitLine("// To parse the JSON, install Gson and do:");
        this.emitLine("//");
        this.emitLine("// val gson = Gson()");
        this.forEachTopLevel("none", (_, name) => {
            this.emitLine("// val ", modifySource(camelCase, name), " = ", "gson.fromJson(jsonString, ", name, "::class.java)");
        });
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(["enum class ", enumName], () => {
            let count = e.cases.size;
            this.forEachEnumCase(e, "none", (name, json) => {
                this.emitLine("@SerializedName(\"", json, "\")");
                this.emitLine(name, --count === 0 ? ";" : ",");
            });
            this.ensureBlankLine();
        });
    }
}

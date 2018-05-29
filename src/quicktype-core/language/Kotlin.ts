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
import { mustNotHappen } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { ArrayType, ClassProperty, ClassType, EnumType, MapType, ObjectType, Type, UnionType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { RenderContext } from "../Renderer";
import { iterableSome, arrayIntercalate } from "../support/Containers";

export enum Framework {
    None,
    Klaxon
}

export const kotlinOptions = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        [["just-types", Framework.None], ["klaxon", Framework.Klaxon]],
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
        return new KotlinRenderer(this, renderContext, getOptionValues(kotlinOptions, untypedOptionValues));
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
        private readonly _kotlinOptions: OptionValues<typeof kotlinOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    get _justTypes() {
        return this._kotlinOptions.framework === Framework.None;
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

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    private emitBlock(line: Sourcelike, f: () => void, delimiter: "curly" | "paren" = "curly"): void {
        const [open, close] = delimiter === "curly" ? ["{", "}"] : ["(", ")"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }

    private kotlinType(t: Type, withIssues: boolean = false, noOptional: boolean = false): Sourcelike {
        const optional = noOptional ? "" : "?";
        return matchType<Sourcelike>(
            t,
            _anyType => {
                return maybeAnnotated(withIssues, anyTypeIssueAnnotation, ["Any", optional]);
            },
            _nullType => {
                return maybeAnnotated(withIssues, nullTypeIssueAnnotation, ["Any", optional]);
            },
            _boolType => "Boolean",
            _integerType => "Long",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => ["List<", this.kotlinType(arrayType.items, withIssues), ">"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map<String, ", this.kotlinType(mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return [this.kotlinType(nullable, withIssues), optional];
                return this.nameForNamedType(unionType);
            }
        );
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

    private emitHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this._justTypes) {
            this.emitLine("// To parse the JSON, install Klaxon and do:");
            this.emitLine("//");
            this.forEachTopLevel("none", (_, name) => {
                this.emitLine("//   val ", modifySource(camelCase, name), " = ", name, ".fromJson(jsonString)");
            });
        }

        this.ensureBlankLine();
        this.emitLine("package ", this._kotlinOptions.packageName);
        this.ensureBlankLine();

        if (this._kotlinOptions.framework === Framework.Klaxon) {
            this.emitLine("import com.beust.klaxon.*");
        }
    }

    private emitTopLevelArray(t: ArrayType, name: Name): void {
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

    private emitTopLevelMap(t: MapType, name: Name): void {
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

    private emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        if (this._kotlinOptions.framework === Framework.Klaxon) {
            this.emitLine("typealias ", className, " = JsonObject");
        } else {
            this.emitLine("class ", className, "()");
        }
    }

    private emitClassDefinition(c: ClassType, className: Name): void {
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

                if (this._kotlinOptions.framework === Framework.Klaxon) {
                    const rename = this.klaxonRenameAttribute(name, jsonName);
                    if (rename !== undefined) {
                        meta.push(() => this.emitLine(rename));
                    }
                }

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

        const isTopLevel = iterableSome(this.topLevels, ([_, top]) => top === c);
        if (this._kotlinOptions.framework === Framework.Klaxon && isTopLevel) {
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

    private emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        if (this._kotlinOptions.framework === Framework.Klaxon) {
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
        } else {
            this.emitBlock(["enum class ", enumName], () => {
                let count = e.cases.size;
                this.forEachEnumCase(e, "none", name => {
                    this.emitLine(name, --count === 0 ? "" : ",");
                });
            });
        }
    }

    private emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
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
            if (this._kotlinOptions.framework === Framework.Klaxon) {
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
                            table.push([
                                [this.unionMemberJsonValueGuard(maybeNull, "jv.inside")],
                                [" -> ", name, "()"]
                            ]);
                        }
                        table.push([["else"], [" -> throw IllegalArgumentException()"]]);
                        this.emitTable(table);
                    });
                    this.emitLine("}");
                });
            }
        });
    }

    protected emitSourceStructure(): void {
        this.emitHeader();

        if (this._kotlinOptions.framework === Framework.Klaxon) {
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

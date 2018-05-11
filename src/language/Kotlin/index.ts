import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../../ConvenienceRenderer";
import { Name, Namer, funPrefixNamer } from "../../Naming";
import { EnumOption, Option, StringOption } from "../../RendererOptions";
import { Sourcelike, maybeAnnotated, modifySource } from "../../Source";
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
} from "../../Strings";
import { TargetLanguage } from "../../TargetLanguage";
import {
    ArrayType,
    ClassProperty,
    ClassType,
    EnumType,
    MapType,
    ObjectType,
    Type,
    UnionType,
    PrimitiveType
} from "../../Type";
import { TypeGraph } from "../../TypeGraph";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../../TypeUtils";
import { OrderedSet } from "immutable";

import { KotlinKlaxonRenderer } from "./KotlinKlaxonRenderer";
import { KotlinMoshiRenderer } from "./KotlinMoshiRenderer";

export type KotlinRendererClass = new (
    targetLanguage: TargetLanguage,
    graph: TypeGraph,
    leadingComments: string[] | undefined,
    ...optionValues: any[]
) => KotlinRenderer;

export default class KotlinTargetLanguage extends TargetLanguage {
    private readonly _frameworkOption = new EnumOption<KotlinRendererClass>(
        "framework",
        "Serialization framework",
        [["just-types", KotlinRenderer], ["klaxon", KotlinKlaxonRenderer], ["moshi", KotlinMoshiRenderer]],
        "moshi"
    );

    private readonly _packageName = new StringOption("package", "Package", "PACKAGE", "quicktype");

    constructor() {
        super("Kotlin", ["kotlin"], "kt");
    }

    protected getOptions(): Option<any>[] {
        return [this._frameworkOption, this._packageName];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected get rendererClass(): KotlinRendererClass {
        class KotlinRendererProxy extends KotlinRenderer {
            constructor(
                targetLanguage: TargetLanguage,
                graph: TypeGraph,
                leadingComments: string[] | undefined,
                rendererClass: KotlinRendererClass,
                packageName: string
            ) {
                super(targetLanguage, graph, leadingComments, packageName);
                return new rendererClass(targetLanguage, graph, leadingComments, packageName);
            }
        }
        return KotlinRendererProxy as any;
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
    "List"
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
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _package: string
    ) {
        super(targetLanguage, graph, leadingComments);
    }

    get justTypes() {
        return this.frameworkName() === undefined;
    }

    protected frameworkForbiddenNames(): string[] {
        return [];
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords.concat(this.frameworkForbiddenNames());
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

    protected emitBlock(line: Sourcelike, f: () => void, delimiter: "curly" | "paren" = "curly"): void {
        const [open, close] = delimiter === "curly" ? ["{", "}"] : ["(", ")"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }

    protected kotlinType(t: Type, withIssues: boolean = false, noOptional: boolean = false): Sourcelike {
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

    protected frameworkName(): string | undefined {
        return undefined;
    }

    protected frameworkImports(): string[] {
        return [];
    }

    private emitHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this.justTypes) {
            this.emitLine(`// To parse the JSON, install ${this.frameworkName()} and do:`);
            this.emitLine("//");
            this.forEachTopLevel("none", (_, name) => {
                this.emitLine("//   val ", modifySource(camelCase, name), " = ", name, ".fromJson(jsonString)");
            });
        }

        this.ensureBlankLine();
        this.emitLine("package ", this._package);
        this.ensureBlankLine();

        for (const path of this.frameworkImports()) {
            this.emitLine(`import ${path}`);
        }
        this.ensureBlankLine();
    }

    protected emitTopLevelArrayBody(_t: ArrayType, _name: Name): void {
        return;
    }

    private emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.kotlinType(t.items);
        if (this.justTypes) {
            this.emitLine("typealias ", name, " = Array<", elementType, ">");
        } else {
            this.emitBlock(
                ["class ", name, "(elements: Collection<", elementType, ">) : ArrayList<", elementType, ">(elements)"],
                () => {
                    this.emitTopLevelArrayBody(t, name);
                }
            );
        }
    }

    protected emitTopLevelMapBody(_t: MapType, _name: Name): void {
        return;
    }

    private emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.kotlinType(t.values);
        if (this.justTypes) {
            this.emitLine("typealias ", name, " = Map<String, ", elementType, ">");
        } else {
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
                () => this.emitTopLevelMapBody(t, name)
            );
        }
    }

    protected makeRenameAttribute(escapedKotlinStringLiteral: String): Sourcelike {
        return ["@Json(name = ", escapedKotlinStringLiteral, ")"] as Sourcelike;
    }

    private renameAttribute(propName: Name, jsonName: string): Sourcelike | undefined {
        const escapedName = stringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        return namesDiffer ? this.makeRenameAttribute(`"${escapedName}"`) : undefined;
    }

    protected emitEmptyClassDefinition(className: Name): void {
        this.emitLine("class ", className, "()");
    }

    protected emitClassBody(_className: Name): void {
        return;
    }

    private emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().count() === 0) {
            this.emitDescription(this.descriptionForType(c));
            this.emitEmptyClassDefinition(className);
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
            let count = c.getProperties().count();
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

                if (!this.justTypes) {
                    const rename = this.renameAttribute(name, jsonName);
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

        const isTopLevel = this.topLevels.findEntry(top => top.equals(c)) !== undefined;
        if (!isTopLevel || this.justTypes) {
            this.emitLine(")");
        } else {
            this.emitBlock(")", () => this.emitClassBody(className));
        }
    }

    private emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        if (this.justTypes) {
            this.emitBlock(["enum class ", enumName], () => {
                let count = e.cases.count();
                this.forEachEnumCase(e, "none", name => {
                    this.emitLine(name, --count === 0 ? "" : ",");
                });
            });
        } else {
            this.emitBlock(["enum class ", enumName, "(val value: String)"], () => {
                let count = e.cases.count();
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
    }

    protected emitUnionBody(
        _u: UnionType,
        _unionName: Name,
        _maybeNull: PrimitiveType | null,
        _nonNulls: OrderedSet<Type>
    ): void {
        return;
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
            let table: Sourcelike[][] = [];
            this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                table.push([["class ", name, "(val value: ", this.kotlinType(t), ")"], [" : ", unionName, "()"]]);
            });
            if (maybeNull !== null) {
                table.push([["class ", this.nameForUnionMember(u, maybeNull), "()"], [" : ", unionName, "()"]]);
            }
            this.emitTable(table);
            if (!this.justTypes) {
                this.ensureBlankLine();
                this.emitUnionBody(u, unionName, maybeNull, nonNulls);
            }
        });
    }

    protected emitFrameworkPreface(): void {
        // Pass
    }

    protected emitSourceStructure(): void {
        this.emitHeader();
        this.emitFrameworkPreface();

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

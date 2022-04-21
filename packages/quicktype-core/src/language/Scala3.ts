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
    None
}

export const scala3Options = {
    framework: new EnumOption(
        "framework",
        "Serialization framework",
        [["just-types", Framework.None]],
        "klaxon"
    ),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype")
};

export class Scala3TargetLanguage extends TargetLanguage {
    constructor() {
        super("Scala3", ["scala3"], "scala");
    }

    protected getOptions(): Option<any>[] {
        return [scala3Options.framework, scala3Options.packageName];
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
        const options = getOptionValues(scala3Options, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new Scala3Renderer(this, renderContext, options);
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

export class Scala3Renderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _kotlinOptions: OptionValues<typeof scala3Options>
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

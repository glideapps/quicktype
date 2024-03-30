import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { EnumOption, Option, StringOption, OptionValues, getOptionValues } from "../RendererOptions";
import { Sourcelike, maybeAnnotated } from "../Source";
import {
    allLowerWordStyle,
    allUpperWordStyle,
    combineWords,
    firstUpperWordStyle,
    isDigit,
    isLetterOrUnderscore,
    isNumeric,
    legalizeCharacters,
    splitIntoWords
} from "../support/Strings";
import { assertNever } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import { ArrayType, ClassProperty, ClassType, EnumType, MapType, ObjectType, Type, UnionType } from "../Type";
import { matchCompoundType, matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { RenderContext } from "../Renderer";

export enum Framework {
    None
}

export const SmithyOptions = {
    framework: new EnumOption("framework", "Serialization framework", [["just-types", Framework.None]], undefined),
    packageName: new StringOption("package", "Package", "PACKAGE", "quicktype")
};

// Use backticks for param names with symbols
const invalidSymbols = [
    ":",
    "-",
    "+",
    "!",
    "@",
    "#",
    "%",
    "^",
    "&",
    "*",
    "(",
    ")",
    ">",
    "<",
    "/",
    ";",
    "'",
    '"',
    "{",
    "}",
    ":",
    "~",
    "`",
    "."
];

const keywords = [
    "abstract",
    "case",
    "catch",
    "do",
    "else",
    "export",
    "false",
    "final",
    "finally",
    "for",
    "forSome",
    "if",
    "implicit",
    "import",
    "new",
    "override",
    "package",
    "private",
    "protected",
    "return",
    "sealed",
    "super",
    "this",
    "then",
    "throw",
    "trait",
    "try",
    "true",
    "val",
    "var",
    "while",
    "with",
    "yield",
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
    "Enum"
];

/**
 * Check if given parameter name should be wrapped in a backtick
 * @param paramName
 */
const shouldAddBacktick = (paramName: string): boolean => {
    return (
        keywords.some(s => paramName === s) ||
        invalidSymbols.some(s => paramName.includes(s)) ||
        !isNaN(parseFloat(paramName)) ||
        !isNaN(parseInt(paramName.charAt(0)))
    );
};

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function scalaNameStyle(isUpper: boolean, original: string): string {
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

const upperNamingFunction = funPrefixNamer("upper", s => scalaNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer("lower", s => scalaNameStyle(false, s));

export class Smithy4sRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _scalaOptions: OptionValues<typeof SmithyOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_: ObjectType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected topLevelNameStyle(rawName: string): string {
        return scalaNameStyle(true, rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return lowerNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return funPrefixNamer("upper", s => scalaNameStyle(true, s) + "Value");
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("upper", s => s.replace(" ", "")); // TODO - add backticks where appropriate
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, { lineStart: " * ", beforeComment: "/**", afterComment: " */" });
    }

    protected emitBlock(
        line: Sourcelike,
        f: () => void,
        delimiter: "curly" | "paren" | "lambda" | "none" = "curly"
    ): void {
        const [open, close] =
            delimiter === "curly"
                ? ["{", "}"]
                : delimiter === "paren"
                ? ["(", ")"]
                : delimiter === "none"
                ? ["", ""]
                : ["{", "})"];
        this.emitLine(line, " ", open);
        this.indent(f);
        this.emitLine(close);
    }

    protected anySourceType(_: boolean): Sourcelike {
        return ["Document"];
    }

    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    protected arrayType(arrayType: ArrayType, _ = false): Sourcelike {
        //this.emitTopLevelArray(arrayType, new Name(arrayType.getCombinedName().toString() + "List"))
        return arrayType.getCombinedName().toString() + "List";
    }

    protected emitArrayType(_: ArrayType, smithyType: Sourcelike): void {
        this.emitLine(["list ", smithyType, " { member : ", "}"]);
    }

    protected mapType(mapType: MapType, _ = false): Sourcelike {
        return mapType.getCombinedName().toString() + "Map";
        //return [this.scalaType(mapType.values, withIssues), "Map"];
    }

    protected scalaType(t: Type, withIssues = false, noOptional = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => {
                return maybeAnnotated(withIssues, anyTypeIssueAnnotation, this.anySourceType(!noOptional));
            },
            _nullType => {
                //return "None.type"
                return maybeAnnotated(withIssues, nullTypeIssueAnnotation, this.anySourceType(!noOptional));
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
                if (nullable !== null) {
                    return [this.scalaType(nullable, withIssues)];
                }
                return this.nameForNamedType(unionType);
            }
        );
    }

    protected emitUsageHeader(): void {
        // To be overridden
    }

    protected emitHeader(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else {
            this.emitUsageHeader();
        }

        this.ensureBlankLine();
        this.emitLine('$version: "2"');
        this.emitLine("namespace ", this._scalaOptions.packageName);
        this.ensureBlankLine();

        this.emitLine("document NullValue");
        this.ensureBlankLine();
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.scalaType(t.items);
        this.emitLine(["list ", name, " { member : ", elementType, "}"]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.scalaType(t.values);
        this.emitLine(["map ", name, " { map[ key : String , value : ", elementType, "}"]);
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("structure ", className, "{}");
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }

        const scalaType = (p: ClassProperty) => {
            if (p.isOptional) {
                return [this.scalaType(p.type, true, true)];
            } else {
                return [this.scalaType(p.type, true)];
            }
        };

        const emitLater: Array<ClassProperty> = [];

        this.emitDescription(this.descriptionForType(c));
        this.emitLine("structure ", className, " {");
        this.indent(() => {
            let count = c.getProperties().size;
            let first = true;

            this.forEachClassProperty(c, "none", (_, jsonName, p) => {
                const nullable = p.type.kind === "union" && nullableFromUnion(p.type as UnionType) !== null;
                const nullableOrOptional = p.isOptional || p.type.kind === "null" || nullable;
                const last = --count === 0;
                const meta: Array<() => void> = [];

                const laterType = p.type.kind === "array" || p.type.kind === "map";
                if (laterType) {
                    emitLater.push(p);
                }

                const description = this.descriptionForClassProperty(c, jsonName);
                if (description !== undefined) {
                    meta.push(() => this.emitDescription(description));
                }

                if (meta.length > 0 && !first) {
                    this.ensureBlankLine();
                }

                for (const emit of meta) {
                    emit();
                }
                const nameNeedsBackticks = jsonName.endsWith("_") || shouldAddBacktick(jsonName);
                const nameWithBackticks = nameNeedsBackticks ? "`" + jsonName + "`" : jsonName;
                this.emitLine(
                    p.isOptional ? "" : nullableOrOptional ? "" : "@required ",
                    nameWithBackticks,
                    " : ",
                    scalaType(p),

                    last ? "" : ","
                );

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });
        this.emitClassDefinitionMethods(emitLater);
    }

    protected emitClassDefinitionMethods(arrayTypes: ClassProperty[]) {
        this.emitLine("}");
        arrayTypes.forEach(p => {
            function ignore<T extends Type>(_: T): void {
                return;
            }
            matchCompoundType(
                p.type,
                at => {
                    this.emitLine([
                        "list ",
                        this.scalaType(at, true),
                        "{ member: ",
                        this.scalaType(at.items, true),
                        "}"
                    ]);
                },
                ignore,
                mt => {
                    this.emitLine([
                        "map ",
                        this.scalaType(mt, true),
                        "{ key: String , value: ",
                        this.scalaType(mt.values, true),
                        "}"
                    ]);
                },
                ignore,
                ignore
            );
        });
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.ensureBlankLine();
        this.emitItem(["enum ", enumName, " { "]);
        let count = e.cases.size;

        this.forEachEnumCase(e, "none", (name, jsonName) => {
            // if (!(jsonName == "")) {
            /*                 const backticks = 
                                    shouldAddBacktick(jsonName) || 
                                    jsonName.includes(" ") || 
                                    !isNaN(parseInt(jsonName.charAt(0)))
                                if (backticks) {this.emitItem("`")} else  */
            this.emitLine();

            this.emitItem([name, ' = "', jsonName, '"']);

            //                if (backticks) {this.emitItem("`")}
            if (--count > 0) this.emitItem([","]);
            //} else {
            //--count
            //}
        });

        this.ensureBlankLine();
        this.emitItem(["}"]);
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        const emitLater: Array<Type> = [];

        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        const theTypes: Array<Sourcelike> = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
            const laterType = t.kind === "array" || t.kind === "map";
            if (laterType) {
                emitLater.push(t);
            }
            theTypes.push(this.scalaType(t));
        });
        if (maybeNull !== null) {
            theTypes.push(this.nameForUnionMember(u, maybeNull));
        }

        this.emitLine(["@untagged union ", unionName, " { "]);
        this.indent(() => {
            theTypes.forEach((t, i) => {
                this.emitLine([String.fromCharCode(i + 65), " : ", t]);
            });
        });
        this.emitLine("}");
        this.ensureBlankLine();

        emitLater.forEach(p => {
            function ignore<T extends Type>(_: T): void {
                return;
            }
            matchCompoundType(
                p,
                at => {
                    this.emitLine([
                        "list ",
                        this.scalaType(at, true),
                        "{ member: ",
                        this.scalaType(at.items, true),
                        "}"
                    ]);
                },
                ignore,
                mt => {
                    this.emitLine([
                        "map ",
                        this.scalaType(mt, true),
                        "{ key: String , value: ",
                        this.scalaType(mt.values, true),
                        "}"
                    ]);
                },
                ignore,
                ignore
            );
        });
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

export class SmithyTargetLanguage extends TargetLanguage<"Smithy", ["Smithy"], "smithy"> {
    constructor() {
        super("Smithy", ["Smithy"], "smithy");
    }

    protected getOptions(): Option<any>[] {
        return [SmithyOptions.framework, SmithyOptions.packageName];
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
        const options = getOptionValues(SmithyOptions, untypedOptionValues);

        switch (options.framework) {
            case Framework.None:
                return new Smithy4sRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}

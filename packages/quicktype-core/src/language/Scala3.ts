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
import { assertNever} from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import {
    ArrayType,
    ClassProperty,
    ClassType,
    EnumType,
    MapType,
    ObjectType,    
    Type,
    UnionType
} from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { RenderContext } from "../Renderer";

export enum Framework {
    None,
    Upickle,
    Circe
}

export const scala3Options = {
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
    "$",
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
    "class",
    "def",
    "do",
    "else",
    "enum",
    "extends",
    "export",
    "false",
    "final",
    "finally",
    "for",
    "forSome",
    "if",
    "implicit",
    "import",
    "lazy",
    "match",
    "new",
    "null",
    "object",
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
    "type",
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
    return keywords.some(s => paramName === s) || invalidSymbols.some(s => paramName.includes(s)) || !isNaN(+paramName)  ;
  };

const wrapOption = (s: string, optional: boolean): string => {
    if (optional) {
        return "Option[" + s + "]";
    } else {
        return s;
    }
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

/* function unicodeEscape(codePoint: number): string {
    return "\\u" + intToHex(codePoint, 4);
} */

//const _stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

/* function stringEscape(s: string): string {
    // "$this" is a template string in Kotlin so we have to escape $
    return _stringEscape(s).replace(/\$/g, "\\$");
} */

const upperNamingFunction = funPrefixNamer("upper", s => scalaNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer("lower", s => scalaNameStyle(false, s));

export class Scala3Renderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _scalaOptions: OptionValues<typeof scala3Options>
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
        return funPrefixNamer("upper", s => s.replace(" ","") ); // TODO - add backticks where appropriate
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
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

    protected anySourceType(optional: boolean): Sourcelike {
        return [wrapOption("Any", optional)];
    }

    // (asarazan): I've broken out the following two functions
    // because some renderers, such as kotlinx, can cope with `any`, while some get mad.
    protected arrayType(arrayType: ArrayType, withIssues: boolean = false): Sourcelike {
        return ["Array[", this.scalaType(arrayType.items, withIssues), "]"];
    }

    protected mapType(mapType: MapType, withIssues: boolean = false): Sourcelike {
        return ["Map[String, ", this.scalaType(mapType.values, withIssues), "]"];
    }

    protected scalaType(t: Type, withIssues: boolean = false, noOptional: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => {
                return maybeAnnotated(withIssues, anyTypeIssueAnnotation, this.anySourceType(!noOptional));
            },
            _nullType => {
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
                    if (noOptional) {
                        return [this.scalaType(nullable, withIssues)];
                    } else {
                        return ["Option[", this.scalaType(nullable, withIssues), "]"];
                    }
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
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitUsageHeader();
        }

        this.ensureBlankLine();
        this.emitLine("package ", this._scalaOptions.packageName);
        this.ensureBlankLine();
    }

    protected emitTopLevelArray(t: ArrayType, name: Name): void {
        const elementType = this.scalaType(t.items);
        this.emitLine(["type ", name, " = List[", elementType, "]"]);
    }

    protected emitTopLevelMap(t: MapType, name: Name): void {
        const elementType = this.scalaType(t.values);
        this.emitLine(["type ", name, " = Map[String, ", elementType, "]"]);
    }

    protected emitEmptyClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));        
        this.emitLine("class ", className, "()");
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        if (c.getProperties().size === 0) {
            this.emitEmptyClassDefinition(c, className);
            return;
        }

        const scalaType = (p: ClassProperty) => {
            if (p.isOptional) {
                return ["Option[", this.scalaType(p.type, true, true), "]"];
            } else {
                return this.scalaType(p.type, true);
            }
        };

        this.emitDescription(this.descriptionForType(c));        
        this.emitLine("case class ", className, " (");
        this.indent(() => {
            let count = c.getProperties().size;
            let first = true;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const nullable = p.type.kind === "union" && nullableFromUnion(p.type as UnionType) !== null;
                const nullableOrOptional = p.isOptional || p.type.kind === "null" || nullable;
                const last = --count === 0;
                const meta: Array<() => void> = [];

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
                    "val ",
                    nameWithBackticks,
                    " : ",
                    scalaType(p),
                    p.isOptional ? " = None" : nullableOrOptional ? " = None" : "",
                    last ? "" : ","
                );

                if (meta.length > 0 && !last) {
                    this.ensureBlankLine();
                }

                first = false;
            });
        });

        this.emitClassDefinitionMethods();
    }

    protected emitClassDefinitionMethods() {
        this.emitLine(")");
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        this.emitBlock(
            ["enum ", enumName, " : "],
            () => {
                let count = e.cases.size;
                if (count > 0) {this.emitItem("\t case ")};
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    if (!(jsonName == "")) {
                        const backticks = 
                            shouldAddBacktick(jsonName) || 
                            jsonName.includes(" ") || 
                            !isNaN(parseInt(jsonName.charAt(0)))
                        if (backticks) {this.emitItem("`")}
                        this.emitItemOnce([ name ]);
                        if (backticks) {this.emitItem("`")}
                        if (--count > 0) this.emitItem([ "," ]);
                    }
                });
            },
            "none"
        );
    }

    protected emitUnionDefinition(u: UnionType, unionName: Name): void {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        this.emitDescription(this.descriptionForType(u));
        
        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);        
        const theTypes : Array<Sourcelike> = []
        this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
            theTypes.push(this.scalaType(t));
        });
        if (maybeNull !== null) {
            theTypes.push(this.nameForUnionMember(u, maybeNull));
        }    
    
        this.emitItem(["type ", unionName, " = "]);
        theTypes.forEach((t, i) => {
            this.emitItem(i === 0 ? t : [" | ", t]);
        });
        this.emitLine();
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

export class UpickleRenderer extends Scala3Renderer {
    
    protected emitClassDefinitionMethods() {
        this.emitLine(") derives ReadWriter");
    }

    protected emitHeader(): void {
        super.emitHeader();

        this.emitLine("import upickle.default.*");
        this.ensureBlankLine();
    }

}


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
            case Framework.Upickle:
                return new UpickleRenderer(this, renderContext, options);
            case Framework.Circe:
                return new UpickleRenderer(this, renderContext, options);
            default:
                return assertNever(options.framework);
        }
    }
}


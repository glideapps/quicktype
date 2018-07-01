import { TargetLanguage } from "../TargetLanguage";
import { StringTypeMapping } from "../TypeBuilder";
import { TransformedStringTypeKind, PrimitiveStringTypeKind, Type, EnumType, ClassType } from "../Type";
import { RenderContext } from "../Renderer";
import { Option, getOptionValues, OptionValues, EnumOption, BooleanOption } from "../RendererOptions";
import { ConvenienceRenderer, ForbiddenWordsInfo, topLevelNameOrder } from "../ConvenienceRenderer";
import { Namer, funPrefixNamer, Name, DependencyName } from "../Naming";
import {
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    utf16LegalizeCharacters,
    allUpperWordStyle,
    allLowerWordStyle,
    stringEscape,
    isAscii,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit
} from "../support/Strings";
import { assertNever, panic, defined } from "../support/Support";
import { Sourcelike, MultiWord, multiWord, singleWord, parenIfNeeded } from "../Source";
import { matchType, nullableFromUnion } from "../TypeUtils";
import { followTargetType } from "../Transformers";
import { arrayIntercalate, setUnionInto, mapUpdateInto } from "collection-utils";

const unicode = require("unicode-properties");

const forbiddenTypeNames = [
    "Any",
    "True",
    "False",
    "None",
    "Enum",
    "List",
    "Dict",
    "Optional",
    "Union",
    "Iterable",
    "Type",
    "TypeVar",
    "T",
    "EnumT"
];
const forbiddenPropertyNames = [
    "and",
    "as",
    "assert",
    "async",
    "await",
    "bool",
    "break",
    "class",
    "continue",
    "datetime",
    "def",
    "del",
    "dict",
    "elif",
    "else",
    "except",
    "finally",
    "float",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "int",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "print",
    "raise",
    "return",
    "self",
    "str",
    "try",
    "while",
    "with",
    "yield"
];

export type PythonVersion = 2 | 3;
export type PythonFeatures = {
    version: 2 | 3;
    typeHints: boolean;
    dataClasses: boolean;
};

export const pythonOptions = {
    features: new EnumOption<PythonFeatures>(
        "python-version",
        "Python version",
        [
            ["2.7", { version: 2, typeHints: false, dataClasses: false }],
            ["3.5", { version: 3, typeHints: false, dataClasses: false }],
            ["3.6", { version: 3, typeHints: true, dataClasses: false }],
            ["3.7", { version: 3, typeHints: true, dataClasses: true }]
        ],
        "3.6"
    ),
    justTypes: new BooleanOption("just-types", "Interfaces only", false)
};

export class PythonTargetLanguage extends TargetLanguage {
    protected getOptions(): Option<any>[] {
        return [pythonOptions.features, pythonOptions.justTypes];
    }

    get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        const dateTimeType = "date-time";
        mapping.set("date", dateTimeType);
        mapping.set("time", dateTimeType);
        mapping.set("date-time", dateTimeType);
        // FIXME: Implement transformers
        // mapping.set("integer-string", "integer-string");
        return mapping;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    get supportsOptionalClassProperties(): boolean {
        return false;
    }

    needsTransformerForType(_t: Type): boolean {
        return false;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): PythonRenderer {
        const options = getOptionValues(pythonOptions, untypedOptionValues);
        if (options.justTypes) {
            return new PythonRenderer(this, renderContext, options);
        } else {
            return new JSONPythonRenderer(this, renderContext, options);
        }
    }
}

function isStartCharacter2(utf16Unit: number): boolean {
    return isAscii(utf16Unit) && isLetterOrUnderscore(utf16Unit);
}

function isPartCharacter2(utf16Unit: number): boolean {
    return isAscii(utf16Unit) && isLetterOrUnderscoreOrDigit(utf16Unit);
}

function isNormalizedStartCharacter3(utf16Unit: number): boolean {
    // FIXME: add Other_ID_Start - https://docs.python.org/3/reference/lexical_analysis.html#identifiers
    if (utf16Unit === 0x5f) return true;
    const category: string = unicode.getCategory(utf16Unit);
    return ["Lu", "Ll", "Lt", "Lm", "Lo", "Nl"].indexOf(category) >= 0;
}

function isNormalizedPartCharacter3(utf16Unit: number): boolean {
    // FIXME: add Other_ID_Continue - https://docs.python.org/3/reference/lexical_analysis.html#identifiers
    if (isNormalizedStartCharacter3(utf16Unit)) return true;
    const category: string = unicode.getCategory(utf16Unit);
    return ["Mn", "Mc", "Nd", "Pc"].indexOf(category) >= 0;
}

function isStartCharacter3(utf16Unit: number): boolean {
    const s = String.fromCharCode(utf16Unit).normalize("NFKC");
    const l = s.length;
    if (l === 0 || !isNormalizedStartCharacter3(s.charCodeAt(0))) return false;
    for (let i = 1; i < l; i++) {
        if (!isNormalizedPartCharacter3(s.charCodeAt(i))) return false;
    }
    return true;
}

function isPartCharacter3(utf16Unit: number): boolean {
    const s = String.fromCharCode(utf16Unit).normalize("NFKC");
    const l = s.length;
    for (let i = 0; i < l; i++) {
        if (!isNormalizedPartCharacter3(s.charCodeAt(i))) return false;
    }
    return true;
}

const legalizeName2 = utf16LegalizeCharacters(isPartCharacter2);
const legalizeName3 = utf16LegalizeCharacters(isPartCharacter3);

function classNameStyle(version: PythonVersion, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        version === 2 ? legalizeName2 : legalizeName3,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        version === 2 ? isStartCharacter2 : isStartCharacter3
    );
}

function snakeNameStyle(version: PythonVersion, original: string, uppercase: boolean): string {
    const wordStyle = uppercase ? allUpperWordStyle : allLowerWordStyle;
    const words = splitIntoWords(original);
    return combineWords(
        words,
        version === 2 ? legalizeName2 : legalizeName3,
        wordStyle,
        wordStyle,
        wordStyle,
        wordStyle,
        "_",
        isStartCharacter3
    );
}

export class PythonRenderer extends ConvenienceRenderer {
    private readonly imports: Map<string, Set<string>> = new Map();
    private readonly declaredTypes: Set<Type> = new Set();

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly pyOptions: OptionValues<typeof pythonOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return forbiddenTypeNames;
    }

    protected forbiddenForObjectProperties(_: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: forbiddenPropertyNames, includeGlobalForbidden: false };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("type", s => classNameStyle(this.pyOptions.features.version, s));
    }

    protected namerForObjectProperty(): Namer {
        return funPrefixNamer("property", s => snakeNameStyle(this.pyOptions.features.version, s, false));
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-case", s => snakeNameStyle(this.pyOptions.features.version, s, true));
    }

    protected get commentLineStart(): string {
        return "# ";
    }

    protected emitDescriptionBlock(lines: string[]): void {
        if (lines.length === 1) {
            this.emitLine('"""', lines[0], '"""');
        } else {
            this.emitCommentLines(lines, "", undefined, '"""', '"""');
        }
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    protected canBeForwardDeclared(t: Type): boolean {
        const kind = t.kind;
        return kind === "class" || kind === "enum";
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line);
        this.indent(f);
    }

    protected string(s: string): Sourcelike {
        const openQuote = this.pyOptions.features.version === 2 ? 'u"' : '"';
        return [openQuote, stringEscape(s), '"'];
    }

    protected withImport(module: string, name: string): Sourcelike {
        if (this.pyOptions.features.typeHints || module !== "typing") {
            // FIXME: This is ugly.  We should rather not generate that import in the first
            // place, but right now we just make the type source and then throw it away.  It's
            // not a performance issue, so it's fine, I just bemoan this special case, and
            // potential others down the road.
            mapUpdateInto(this.imports, module, s => (s ? setUnionInto(s, [name]) : new Set([name])));
        }
        return name;
    }

    protected withTyping(name: string): Sourcelike {
        return this.withImport("typing", name);
    }

    protected namedType(t: Type): Sourcelike {
        const name = this.nameForNamedType(t);
        if (this.declaredTypes.has(t)) return name;
        return ["'", name, "'"];
    }

    protected pythonType(t: Type): Sourcelike {
        const actualType = followTargetType(t);
        return matchType<Sourcelike>(
            actualType,
            _anyType => this.withTyping("Any"),
            _nullType => "None",
            _boolType => "bool",
            _integerType => "int",
            _doubletype => "float",
            _stringType => "str",
            arrayType => [this.withTyping("List"), "[", this.pythonType(arrayType.items), "]"],
            classType => this.namedType(classType),
            mapType => [this.withTyping("Dict"), "[str, ", this.pythonType(mapType.values), "]"],
            enumType => this.namedType(enumType),
            unionType => {
                const maybeNullable = nullableFromUnion(unionType);
                if (maybeNullable !== null) {
                    return [this.withTyping("Optional"), "[", this.pythonType(maybeNullable), "]"];
                }
                const memberTypes = Array.from(unionType.sortedMembers).map(m => this.pythonType(m));
                return [this.withTyping("Union"), "[", arrayIntercalate(", ", memberTypes), "]"];
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return this.withImport("datetime", "datetime");
                }
                return panic(`Transformed type ${transformedStringType.kind} not supported`);
            }
        );
    }

    protected declarationLine(t: Type): Sourcelike {
        if (t instanceof ClassType) {
            return ["class ", this.nameForNamedType(t), ":"];
        }
        if (t instanceof EnumType) {
            return ["class ", this.nameForNamedType(t), "(", this.withImport("enum", "Enum"), "):"];
        }
        return panic(`Can't declare type ${t.kind}`);
    }

    protected declareType<T extends Type>(t: T, emitter: () => void): void {
        this.emitBlock(this.declarationLine(t), () => {
            this.emitDescription(this.descriptionForType(t));
            emitter();
        });
        this.declaredTypes.add(t);
    }

    protected emitClassMembers(t: ClassType): void {
        if (this.pyOptions.features.dataClasses) return;

        const args: Sourcelike[] = [];
        this.forEachClassProperty(t, "none", (name, _, cp) => {
            args.push([name, this.typeHint(": ", this.pythonType(cp.type))]);
        });
        this.emitBlock(
            ["def __init__(self, ", arrayIntercalate(", ", args), ")", this.typeHint(" -> None"), ":"],
            () => {
                if (args.length === 0) {
                    this.emitLine("pass");
                } else {
                    this.forEachClassProperty(t, "none", name => {
                        this.emitLine("self.", name, " = ", name);
                    });
                }
            }
        );
    }

    protected typeHint(...sl: Sourcelike[]): Sourcelike {
        if (this.pyOptions.features.typeHints) {
            return sl;
        }
        return [];
    }

    protected typingDecl(name: Sourcelike, type: string): Sourcelike {
        return [name, this.typeHint(": ", this.withTyping(type))];
    }

    protected typingReturn(type: string): Sourcelike {
        return this.typeHint(" -> ", this.withTyping(type));
    }

    protected emitClass(t: ClassType): void {
        if (this.pyOptions.features.dataClasses) {
            this.emitLine("@", this.withImport("dataclasses", "dataclass"));
        }
        this.declareType(t, () => {
            if (this.pyOptions.features.typeHints) {
                if (t.getProperties().size === 0) {
                    this.emitLine("pass");
                } else {
                    this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                        this.emitDescription(this.descriptionForClassProperty(t, jsonName));
                        this.emitLine(name, this.typeHint(": ", this.pythonType(cp.type)));
                    });
                }
                this.ensureBlankLine();
            }
            this.emitClassMembers(t);
        });
    }

    protected emitEnum(t: EnumType): void {
        this.declareType(t, () => {
            this.forEachEnumCase(t, "none", (name, jsonName) => {
                this.emitLine([name, " = ", this.string(jsonName)]);
            });
        });
    }

    protected emitImports(): void {
        this.imports.forEach((names, module) => {
            this.emitLine("from ", module, " import ", Array.from(names).join(", "));
        });
    }

    protected emitDefaultLeadingComments(): void {
        if (this.pyOptions.features.version === 2) {
            this.emitCommentLines(["coding: utf-8"]);
            this.ensureBlankLine();
            if (this.haveEnums) {
                this.emitCommentLines([
                    "",
                    "To use this code in Python 2.7 you'll have to",
                    "",
                    "    pip install enum34"
                ]);
            }
        }
    }

    protected emitSupportCode(): void {
        return;
    }

    protected emitClosingCode(): void {
        return;
    }

    protected emitSourceStructure(_givenOutputFilename: string): void {
        const declarationLines = this.gatherSource(() => {
            this.forEachNamedType(
                ["interposing", 2],
                (c: ClassType) => this.emitClass(c),
                e => this.emitEnum(e),
                _u => {
                    return;
                }
            );
        });

        const closingLines = this.gatherSource(() => this.emitClosingCode());
        const supportLines = this.gatherSource(() => this.emitSupportCode());

        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitDefaultLeadingComments();
        }
        this.ensureBlankLine();
        this.emitImports();
        this.ensureBlankLine(2);
        this.emitGatheredSource(supportLines);
        this.ensureBlankLine(2);
        this.emitGatheredSource(declarationLines);
        this.ensureBlankLine(2);
        this.emitGatheredSource(closingLines);
    }
}

export type ConverterFunction =
    | "none"
    | "bool"
    | "int"
    | "from-float"
    | "to-float"
    | "str"
    | "to-enum"
    | "list"
    | "to-class"
    | "dict"
    | "union"
    | "from-datetime";

type TopLevelConverterNames = {
    fromDict: Name;
    toDict: Name;
};

export type ValueOrLambda = {
    value?: Sourcelike;
    lambda?: MultiWord;
};

function makeLambda(vol: ValueOrLambda): MultiWord {
    if (vol.lambda !== undefined) {
        return vol.lambda;
    } else if (vol.value !== undefined) {
        return multiWord(" ", "lambda x:", vol.value);
    }
    return panic("Invalid ValueOrLambda");
}

function makeValue(argument: Sourcelike, vol: ValueOrLambda): Sourcelike {
    if (vol.value !== undefined) {
        return vol.value;
    } else if (vol.lambda !== undefined) {
        return [parenIfNeeded(vol.lambda), "(", argument, ")"];
    }
    return panic("Invalid ValueOrLambda");
}

export class JSONPythonRenderer extends PythonRenderer {
    private readonly _deserializerFunctions = new Set<ConverterFunction>();
    private readonly _converterNamer = funPrefixNamer("converter", s =>
        snakeNameStyle(this.pyOptions.features.version, s, false)
    );
    private readonly _topLevelConverterNames = new Map<Name, TopLevelConverterNames>();
    private _haveTypeVar = false;
    private _haveEnumTypeVar = false;
    private _haveDateutil = false;

    protected emitTypeVar(tvar: string, constraints: Sourcelike): void {
        if (!this.pyOptions.features.typeHints) {
            return;
        }
        this.emitLine(tvar, " = ", this.withTyping("TypeVar"), "(", this.string(tvar), constraints, ")");
    }

    protected typeVar(): string {
        this._haveTypeVar = true;
        // FIXME: This is ugly, but the code that requires the type variables, in
        // `emitImports` actually runs after imports have been imported.  The proper
        // solution would be to either allow more complex dependencies, or to
        // gather-emit the type variable declarations, too.  Unfortunately the
        // gather-emit is a bit buggy with blank lines, and I can't be bothered to
        // fix it now.
        this.withTyping("TypeVar");
        return "T";
    }

    protected enumTypeVar(): string {
        this._haveEnumTypeVar = true;
        // See the comment above.
        this.withTyping("TypeVar");
        this.withImport("enum", "Enum");
        return "EnumT";
    }

    protected cast(type: Sourcelike, v: Sourcelike): Sourcelike {
        if (!this.pyOptions.features.typeHints) {
            return v;
        }
        return [this.withTyping("cast"), "(", type, ", ", v, ")"];
    }

    protected emitNoneConverter(): void {
        // FIXME: We can't return the None type here because mypy thinks that means
        // We're not returning any value, when we're actually returning `None`.
        this.emitBlock(
            ["def from_none(", this.typingDecl("x", "Any"), ")", this.typeHint(" -> ", this.withTyping("Any")), ":"],
            () => {
                this.emitLine("assert x is None");
                this.emitLine("return x");
            }
        );
    }

    protected emitBoolConverter(): void {
        this.emitBlock(["def from_bool(", this.typingDecl("x", "Any"), ")", this.typeHint(" -> bool"), ":"], () => {
            this.emitLine("assert isinstance(x, bool)");
            this.emitLine("return x");
        });
    }

    protected emitIntConverter(): void {
        this.emitBlock(["def from_int(", this.typingDecl("x", "Any"), ")", this.typeHint(" -> int"), ":"], () => {
            this.emitLine("assert isinstance(x, int) and not isinstance(x, bool)");
            this.emitLine("return x");
        });
    }

    protected emitFromFloatConverter(): void {
        this.emitBlock(["def from_float(", this.typingDecl("x", "Any"), ")", this.typeHint(" -> float"), ":"], () => {
            this.emitLine("assert isinstance(x, (float, int)) and not isinstance(x, bool)");
            this.emitLine("return float(x)");
        });
    }

    protected emitToFloatConverter(): void {
        this.emitBlock(["def to_float(", this.typingDecl("x", "Any"), ")", this.typeHint(" -> float"), ":"], () => {
            this.emitLine("assert isinstance(x, float)");
            this.emitLine("return x");
        });
    }

    protected emitStrConverter(): void {
        this.emitBlock(["def from_str(", this.typingDecl("x", "Any"), ")", this.typeHint(" -> str"), ":"], () => {
            const strType = this.pyOptions.features.version === 2 ? "(str, unicode)" : "str";
            this.emitLine("assert isinstance(x, ", strType, ")");
            this.emitLine("return x");
        });
    }

    protected emitToEnumConverter(): void {
        const tvar = this.enumTypeVar();
        this.emitBlock(
            [
                "def to_enum(c",
                this.typeHint(": ", this.withTyping("Type"), "[", tvar, "]"),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", tvar),
                ":"
            ],
            () => {
                this.emitLine("assert isinstance(x, c)");
                this.emitLine("return x.value");
            }
        );
    }

    protected emitListConverter(): void {
        const tvar = this.typeVar();
        this.emitBlock(
            [
                "def from_list(f",
                this.typeHint(": ", this.withTyping("Callable"), "[[", this.withTyping("Any"), "], ", tvar, "]"),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", this.withTyping("List"), "[", tvar, "]"),
                ":"
            ],
            () => {
                this.emitLine("assert isinstance(x, list)");
                this.emitLine("return [f(y) for y in x]");
            }
        );
    }

    protected emitToClassConverter(): void {
        const tvar = this.typeVar();
        this.emitBlock(
            [
                "def to_class(c",
                this.typeHint(": ", this.withTyping("Type"), "[", tvar, "]"),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", tvar),
                ":"
            ],
            () => {
                this.emitLine("assert isinstance(x, c)");
                this.emitLine("return ", this.cast(this.withTyping("Any"), "x"), ".to_dict()");
            }
        );
    }

    protected emitDictConverter(): void {
        const tvar = this.typeVar();
        this.emitBlock(
            [
                "def from_dict(f",
                this.typeHint(": ", this.withTyping("Callable"), "[[", this.withTyping("Any"), "], ", tvar, "]"),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", this.withTyping("Dict"), "[str, ", tvar, "]"),
                ":"
            ],
            () => {
                this.emitLine("assert isinstance(x, dict)");
                this.emitLine("return { k: f(v) for (k, v) in x.items() }");
            }
        );
    }

    // This is not easily idiomatically typeable in Python.  See
    // https://stackoverflow.com/questions/51066468/computed-types-in-mypy/51084497
    protected emitUnionConverter(): void {
        this.emitMultiline(`def from_union(fs, x):
    for f in fs:
        try:
            return f(x)
        except:
            pass
    assert False`);
    }

    protected emitFromDatetimeConverter(): void {
        this.emitBlock(
            [
                "def from_datetime(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", this.withImport("datetime", "datetime")),
                ":"
            ],
            () => {
                this._haveDateutil = true;
                this.emitLine("return dateutil.parser.parse(x)");
            }
        );
    }

    protected emitToDatetimeConverter(): void {
        this.emitBlock(
            [
                "def to_datetime(x",
                this.typeHint(": ", this.withImport("datetime", "datetime")),
                ")",
                this.typeHint(" -> str"),
                ":"
            ],
            () => {
                this.emitLine("assert isinstance(x, datetime)");
                this.emitLine("return x.isoformat()");
            }
        );
    }

    protected emitConverter(cf: ConverterFunction): void {
        switch (cf) {
            case "none":
                return this.emitNoneConverter();
            case "bool":
                return this.emitBoolConverter();
            case "int":
                return this.emitIntConverter();
            case "from-float":
                return this.emitFromFloatConverter();
            case "to-float":
                return this.emitToFloatConverter();
            case "str":
                return this.emitStrConverter();
            case "to-enum":
                return this.emitToEnumConverter();
            case "list":
                return this.emitListConverter();
            case "to-class":
                return this.emitToClassConverter();
            case "dict":
                return this.emitDictConverter();
            case "union":
                return this.emitUnionConverter();
            case "from-datetime":
                return this.emitFromDatetimeConverter();
            default:
                return assertNever(cf);
        }
    }

    protected conv(cf: ConverterFunction): Sourcelike {
        this._deserializerFunctions.add(cf);
        const name = cf.replace("-", "_");
        if (cf.startsWith("from-") || cf.startsWith("to-")) return name;
        return ["from_", name];
    }

    protected convFn(cf: ConverterFunction): MultiWord {
        return singleWord(this.conv(cf));
    }

    protected deserializer(value: Sourcelike, t: Type): ValueOrLambda {
        return matchType<ValueOrLambda>(
            t,
            _anyType => ({ value }),
            _nullType => ({ lambda: this.convFn("none") }),
            _boolType => ({ lambda: this.convFn("bool") }),
            _integerType => ({ lambda: this.convFn("int") }),
            _doubleType => ({ lambda: this.convFn("from-float") }),
            _stringType => ({ lambda: this.convFn("str") }),
            arrayType => ({
                value: [
                    this.conv("list"),
                    "(",
                    makeLambda(this.deserializer("x", arrayType.items)).source,
                    ", ",
                    value,
                    ")"
                ]
            }),
            classType => ({ lambda: singleWord(this.nameForNamedType(classType), ".from_dict") }),
            mapType => ({
                value: [
                    this.conv("dict"),
                    "(",
                    makeLambda(this.deserializer("x", mapType.values)).source,
                    ", ",
                    value,
                    ")"
                ]
            }),
            enumType => ({ lambda: singleWord(this.nameForNamedType(enumType)) }),
            unionType => {
                const deserializers = Array.from(unionType.members).map(
                    m => makeLambda(this.deserializer("x", m)).source
                );
                return { value: [this.conv("union"), "([", arrayIntercalate(", ", deserializers), "], ", value, ")"] };
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return { lambda: this.convFn("from-datetime") };
                }
                return panic(`Transformed type ${transformedStringType.kind} not supported`);
            }
        );
    }

    protected serializer(value: Sourcelike, t: Type): ValueOrLambda {
        return matchType<ValueOrLambda>(
            t,
            _anyType => ({ value }),
            _nullType => ({ lambda: this.convFn("none") }),
            _boolType => ({ lambda: this.convFn("bool") }),
            _integerType => ({ lambda: this.convFn("int") }),
            _doubleType => ({ lambda: this.convFn("to-float") }),
            _stringType => ({ lambda: this.convFn("str") }),
            arrayType => ({
                value: [
                    this.conv("list"),
                    "(",
                    makeLambda(this.serializer("x", arrayType.items)).source,
                    ", ",
                    value,
                    ")"
                ]
            }),
            classType => ({ value: [this.conv("to-class"), "(", this.nameForNamedType(classType), ", ", value, ")"] }),
            mapType => ({
                value: [
                    this.conv("dict"),
                    "(",
                    makeLambda(this.serializer("x", mapType.values)).source,
                    ", ",
                    value,
                    ")"
                ]
            }),
            enumType => ({ value: [this.conv("to-enum"), "(", this.nameForNamedType(enumType), ", ", value, ")"] }),
            unionType => {
                const serializers = Array.from(unionType.members).map(m => makeLambda(this.serializer("x", m)).source);
                return { value: [this.conv("union"), "([", arrayIntercalate(", ", serializers), "], ", value, ")"] };
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return { value: [value, ".isoformat()"] };
                }
                return panic(`Transformed type ${transformedStringType.kind} not supported`);
            }
        );
    }

    protected emitClassMembers(t: ClassType): void {
        super.emitClassMembers(t);
        this.ensureBlankLine();

        const className = this.nameForNamedType(t);

        this.emitLine("@staticmethod");
        this.emitBlock(
            ["def from_dict(", this.typingDecl("obj", "Any"), ")", this.typeHint(" -> ", this.namedType(t)), ":"],
            () => {
                const args: Sourcelike[] = [];
                this.emitLine("assert isinstance(obj, dict)");
                this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                    const property = ["obj.get(", this.string(jsonName), ")"];
                    const propType = followTargetType(cp.type);
                    this.emitLine(name, " = ", makeValue(property, this.deserializer(property, propType)));
                    args.push(name);
                });
                this.emitLine("return ", className, "(", arrayIntercalate(", ", args), ")");
            }
        );
        this.ensureBlankLine();

        this.emitBlock(["def to_dict(self)", this.typeHint(" -> dict"), ":"], () => {
            this.emitLine("result", this.typeHint(": dict"), " = {}");
            this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                const property = ["self.", name];
                const propType = followTargetType(cp.type);
                this.emitLine(
                    "result[",
                    this.string(jsonName),
                    "] = ",
                    makeValue(property, this.serializer(property, propType))
                );
            });
            this.emitLine("return result");
        });
    }

    protected emitImports(): void {
        super.emitImports();
        if (this._haveDateutil) {
            this.emitLine("import dateutil.parser");
        }

        if (!this._haveTypeVar && !this._haveEnumTypeVar) return;

        this.ensureBlankLine(2);
        if (this._haveTypeVar) {
            this.emitTypeVar(this.typeVar(), []);
        }
        if (this._haveEnumTypeVar) {
            this.emitTypeVar(this.enumTypeVar(), [", bound=", this.withImport("enum", "Enum")]);
        }
    }

    protected emitSupportCode(): void {
        const map = Array.from(this._deserializerFunctions).map(f => [f, f] as [ConverterFunction, ConverterFunction]);
        this.forEachWithBlankLines(map, ["interposing", 2], cf => {
            this.emitConverter(cf);
        });
    }

    protected makeTopLevelDependencyNames(_t: Type, topLevelName: Name): DependencyName[] {
        const fromDict = new DependencyName(
            this._converterNamer,
            topLevelNameOrder,
            l => `${l(topLevelName)}_from_dict`
        );
        const toDict = new DependencyName(this._converterNamer, topLevelNameOrder, l => `${l(topLevelName)}_to_dict`);
        this._topLevelConverterNames.set(topLevelName, { fromDict, toDict });
        return [fromDict, toDict];
    }

    protected emitDefaultLeadingComments(): void {
        super.emitDefaultLeadingComments();
        this.ensureBlankLine();
        if (this._haveDateutil) {
            this.emitCommentLines([
                "This code parses date/times, so please",
                "",
                "    pip install python-dateutil",
                ""
            ]);
        }
        this.emitCommentLines([
            "To use this code, make sure you",
            "",
            "    import json",
            "",
            "and then, to convert JSON from a string, do",
            ""
        ]);
        this.forEachTopLevel("none", (_, name) => {
            const { fromDict } = defined(this._topLevelConverterNames.get(name));
            this.emitLine(this.commentLineStart, "    result = ", fromDict, "(json.loads(json_string))");
        });
    }

    protected emitClosingCode(): void {
        this.forEachTopLevel(["interposing", 2], (t, name) => {
            const { fromDict, toDict } = defined(this._topLevelConverterNames.get(name));
            const pythonType = this.pythonType(t);
            this.emitBlock(
                ["def ", fromDict, "(", this.typingDecl("s", "Any"), ")", this.typeHint(" -> ", pythonType), ":"],
                () => {
                    this.emitLine("return ", makeValue("s", this.deserializer("s", t)));
                }
            );
            this.ensureBlankLine(2);
            this.emitBlock(
                ["def ", toDict, "(x", this.typeHint(": ", pythonType), ")", this.typingReturn("Any"), ":"],
                () => {
                    this.emitLine("return ", makeValue("x", this.serializer("x", t)));
                }
            );
        });
    }
}

import { TargetLanguage } from "../TargetLanguage";
import { StringTypeMapping } from "../TypeBuilder";
import {
    TransformedStringTypeKind,
    PrimitiveStringTypeKind,
    Type,
    EnumType,
    ClassType,
    UnionType,
    isPrimitiveStringTypeKind,
    ArrayType
} from "../Type";
import { RenderContext } from "../Renderer";
import { Option } from "../RendererOptions";
import { ConvenienceRenderer, ForbiddenWordsInfo, topLevelNameOrder } from "../ConvenienceRenderer";
import { Namer, funPrefixNamer, Name, DependencyName } from "../Naming";
import {
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    utf16LegalizeCharacters,
    allUpperWordStyle,
    allLowerWordStyle,
    stringEscape
} from "../support/Strings";
import { Declaration } from "../DeclarationIR";
import { assertNever, panic, defined } from "../support/Support";
import { Sourcelike, MultiWord, multiWord, singleWord, parenIfNeeded } from "../Source";
import { matchType, nullableFromUnion } from "../TypeUtils";
import { followTargetType } from "../Transformers";
import { arrayIntercalate, iterableSome, setUnionInto, mapUpdateInto } from "collection-utils";

const unicode = require("unicode-properties");

const forbiddenTypeNames = ["True", "False", "None", "Enum", "List", "Dict", "Optional", "Union", "Iterable"];
const forbiddenPropertyNames = [
    "and",
    "as",
    "assert",
    "bool",
    "break",
    "class",
    "continue",
    "datetime",
    "def",
    "del",
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
    "raise",
    "return",
    "str",
    "try",
    "while",
    "with",
    "yield"
];

export class PythonTargetLanguage extends TargetLanguage {
    protected getOptions(): Option<any>[] {
        return [];
    }

    get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        // No Python programmer apparently ever needed to parse ISO date/times.
        // It's only supported in Python 3.7, which isn't out yet.
        const dateTimeType = "string";
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

    needsTransformerForType(t: Type): boolean {
        if (t instanceof UnionType) {
            return iterableSome(t.members, m => this.needsTransformerForType(m));
        }
        if (t instanceof ArrayType) {
            return this.needsTransformerForType(t.items);
        }
        return t.kind !== "string" && isPrimitiveStringTypeKind(t.kind);
    }

    protected makeRenderer(
        renderContext: RenderContext,
        _untypedOptionValues: { [name: string]: any }
    ): PythonRenderer {
        return new JSONPythonRenderer(this, renderContext);
    }
}

function isNormalizedStartCharacter(utf16Unit: number): boolean {
    // FIXME: add Other_ID_Start - https://docs.python.org/3/reference/lexical_analysis.html#identifiers
    // FIXME: also NFKC normalization
    if (utf16Unit === 0x5f) return true;
    const category: string = unicode.getCategory(utf16Unit);
    return ["Lu", "Ll", "Lt", "Lm", "Lo", "Nl"].indexOf(category) >= 0;
}

function isNormalizedPartCharacter(utf16Unit: number): boolean {
    // FIXME: add Other_ID_Continue - https://docs.python.org/3/reference/lexical_analysis.html#identifiers
    // FIXME: also NFKC normalization
    if (isStartCharacter(utf16Unit)) return true;
    const category: string = unicode.getCategory(utf16Unit);
    return ["Mn", "Mc", "Nd", "Pc"].indexOf(category) >= 0;
}

function isStartCharacter(utf16Unit: number): boolean {
    const s = String.fromCharCode(utf16Unit).normalize("NFKC");
    const l = s.length;
    if (l === 0 || !isNormalizedStartCharacter(s.charCodeAt(0))) return false;
    for (let i = 1; i < l; i++) {
        if (!isNormalizedPartCharacter(s.charCodeAt(i))) return false;
    }
    return true;
}

function isPartCharacter(utf16Unit: number): boolean {
    const s = String.fromCharCode(utf16Unit).normalize("NFKC");
    const l = s.length;
    for (let i = 0; i < l; i++) {
        if (!isNormalizedPartCharacter(s.charCodeAt(i))) return false;
    }
    return true;
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function classNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function snakeNameStyle(original: string, uppercase: boolean): string {
    const wordStyle = uppercase ? allUpperWordStyle : allLowerWordStyle;
    const words = splitIntoWords(original);
    return combineWords(words, legalizeName, wordStyle, wordStyle, wordStyle, wordStyle, "_", isStartCharacter);
}

export class PythonRenderer extends ConvenienceRenderer {
    private readonly imports: Map<string, Set<string>> = new Map();
    private readonly declaredTypes: Set<Type> = new Set();

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return forbiddenTypeNames;
    }

    protected forbiddenForObjectProperties(_: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: forbiddenPropertyNames, includeGlobalForbidden: false };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("type", classNameStyle);
    }

    protected namerForObjectProperty(): Namer {
        return funPrefixNamer("property", s => snakeNameStyle(s, false));
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-case", s => snakeNameStyle(s, true));
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

    protected withImport(module: string, name: string): Sourcelike {
        mapUpdateInto(this.imports, module, s => (s ? setUnionInto(s, [name]) : new Set([name])));
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
        this.emitDescription(this.descriptionForType(t));
        this.emitBlock(this.declarationLine(t), () => {
            emitter();
        });
        this.declaredTypes.add(t);
    }

    protected emitClassMembers(_t: ClassType): void {
        return;
    }

    protected emitClass(t: ClassType): void {
        this.declareType(t, () => {
            if (t.getProperties().size === 0) {
                this.emitLine("pass");
            } else {
                this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                    this.emitDescription(this.descriptionForClassProperty(t, jsonName));
                    this.emitLine(name, ": ", this.pythonType(cp.type));
                });
                this.ensureBlankLine();
            }
            this.emitClassMembers(t);
        });
    }

    protected emitEnum(t: EnumType): void {
        this.declareType(t, () => {
            this.forEachEnumCase(t, "none", (name, jsonName) => {
                this.emitLine([name, ' = "', stringEscape(jsonName), '"']);
            });
        });
    }

    protected emitDeclaration(decl: Declaration): void {
        if (decl.kind === "forward") {
            // We don't need forward declarations yet, since we only generate types.
        } else if (decl.kind === "define") {
            const t = decl.type;
            if (t instanceof ClassType) {
                this.emitClass(t);
            } else if (t instanceof EnumType) {
                this.emitEnum(t);
            } else if (t instanceof UnionType) {
                return;
            } else {
                return panic(`Cannot declare type ${t.kind}`);
            }
        } else {
            return assertNever(decl.kind);
        }
    }

    protected emitImports(): void {
        this.imports.forEach((names, module) => {
            this.emitLine("from ", module, " import ", Array.from(names).join(", "));
        });
    }

    protected emitDefaultLeadingComments(): void {
        this.emitCommentLines(["Only Python >=3.6 right now.  More features coming soon!"]);
    }

    protected emitSupportCode(): void {
        return;
    }

    protected emitClosingCode(): void {
        return;
    }

    protected emitSourceStructure(_givenOutputFilename: string): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitDefaultLeadingComments();
        }

        const declarationLines = this.gatherSource(() => {
            this.forEachDeclaration(["interposing", 2], decl => this.emitDeclaration(decl));
        });

        const closingLines = this.gatherSource(() => this.emitClosingCode());
        const supportLines = this.gatherSource(() => this.emitSupportCode());

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
    | "from-datetime"
    | "to-datetime";

const converterFunctionCodes: { [CF in ConverterFunction]: string } = {
    none: `def from_none(x):
    assert x is None
    return x`,
    bool: `def from_bool(x):
    assert isinstance(x, bool)
    return x`,
    int: `def from_int(x):
    assert isinstance(x, int) and not isinstance(x, bool)
    return x`,
    "from-float": `def from_float(x):
    assert isinstance(x, (float, int)) and not isinstance(x, bool)
    return float(x)`,
    "to-float": `def to_float(x):
    assert isinstance(x, float)
    return x`,
    str: `def from_str(x):
    assert isinstance(x, str)
    return x`,
    "to-enum": `def to_enum(c, x):
    assert isinstance(x, c)
    return x.value`,
    list: `def from_list(f, x):
    assert isinstance(x, list)
    return [f(y) for y in x]`,
    "to-class": `def to_class(c, x):
    assert isinstance(x, c)
    return x.to_dict()`,
    dict: `def from_dict(f, x):
    assert isinstance(x, dict)
    return { k: f(v) for (k, v) in x.items() }`,
    union: `def from_union(fs, x):
    for f in fs:
        try:
            return f(x)
        except:
            pass
    assert False`,
    "from-datetime": `def from_datetime(x):
    # This is not correct.  Python <3.7 doesn't support ISO date-time
    # parsing in the standard library.  This is a kludge until we have
    # that.
    return datetime.strptime(x, "%Y-%m-%dT%H:%M:%S.%fZ")`,
    "to-datetime": `def to_datetime(x):
    assert isinstance(x, datetime)
    return x.isoformat()`
};

function lambda(x: Sourcelike, ...body: Sourcelike[]): MultiWord {
    return multiWord(" ", "lambda", [x, ":"], body);
}

function callFn(fn: MultiWord, ...args: Sourcelike[]): Sourcelike {
    return [parenIfNeeded(fn), "(", arrayIntercalate(", ", args), ")"];
}

const identityFn = lambda("x", "x");

type TopLevelConverterNames = {
    fromDict: Name;
    toDict: Name;
};

export class JSONPythonRenderer extends PythonRenderer {
    private readonly _deserializerFunctions = new Set<ConverterFunction>();
    private readonly _converterNamer = funPrefixNamer("converter", s => snakeNameStyle(s, false));
    private readonly _topLevelConverterNames = new Map<Name, TopLevelConverterNames>();

    protected conv(cf: ConverterFunction): Sourcelike {
        this._deserializerFunctions.add(cf);
        const name = cf.replace("-", "_");
        if (cf.startsWith("from-") || cf.startsWith("to-")) return name;
        return ["from_", name];
    }

    protected convFn(cf: ConverterFunction): MultiWord {
        return singleWord(this.conv(cf));
    }

    protected deserializerFn(t: Type): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => identityFn,
            _nullType => this.convFn("none"),
            _boolType => this.convFn("bool"),
            _integerType => this.convFn("int"),
            _doubleType => this.convFn("from-float"),
            _stringType => this.convFn("str"),
            arrayType =>
                lambda("x", this.conv("list"), "(", parenIfNeeded(this.deserializerFn(arrayType.items)), ", x)"),
            classType => singleWord(this.nameForNamedType(classType)),
            mapType => lambda("x", this.conv("dict"), "(", parenIfNeeded(this.deserializerFn(mapType.values)), ", x)"),
            enumType => singleWord(this.nameForNamedType(enumType)),
            unionType => {
                const deserializers = Array.from(unionType.members).map(m => this.deserializerFn(m).source);
                return lambda("x", this.conv("union"), "([", arrayIntercalate(", ", deserializers), "], x)");
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return lambda("x", callFn(this.convFn("to-datetime"), "x"));
                }
                return panic(`Transformed type ${transformedStringType.kind} not supported`);
            }
        );
    }

    protected deserializer(value: Sourcelike, t: Type): Sourcelike {
        return callFn(this.deserializerFn(t), value);
    }

    protected serializerFn(t: Type): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => identityFn,
            _nullType => this.convFn("none"),
            _boolType => this.convFn("bool"),
            _integerType => this.convFn("int"),
            _doubleType => this.convFn("to-float"),
            _stringType => this.convFn("str"),
            arrayType => lambda("x", this.conv("list"), "(", parenIfNeeded(this.serializerFn(arrayType.items)), ", x)"),
            classType => lambda("x", callFn(this.convFn("to-class"), this.nameForNamedType(classType), "x")),
            mapType => lambda("x", this.conv("dict"), "(", parenIfNeeded(this.serializerFn(mapType.values)), ", x)"),
            enumType => lambda("x", callFn(this.convFn("to-enum"), this.nameForNamedType(enumType), "x")),
            unionType => {
                const serializers = Array.from(unionType.members).map(m => this.serializerFn(m).source);
                return multiWord(
                    "",
                    "lambda x: ",
                    this.conv("union"),
                    "([",
                    arrayIntercalate(", ", serializers),
                    "], x)"
                );
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return lambda("x", "x.isoformat()");
                }
                return panic(`Transformed type ${transformedStringType.kind} not supported`);
            }
        );
    }

    protected serializer(value: Sourcelike, t: Type): Sourcelike {
        return [parenIfNeeded(this.serializerFn(t)), "(", value, ")"];
    }

    protected emitClassMembers(t: ClassType): void {
        this.emitBlock("def __init__(self, obj):", () => {
            this.emitLine("assert isinstance(obj, dict)");
            this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                const property = ['obj.get("', stringEscape(jsonName), '")'];
                this.emitLine("self.", name, " = ", this.deserializer(property, cp.type));
            });
        });
        this.ensureBlankLine();
        this.emitBlock("def to_dict(self):", () => {
            this.emitLine("result = {}");
            this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                const property = ["self.", name];
                this.emitLine('result["', stringEscape(jsonName), '"] = ', this.serializer(property, cp.type));
            });
            this.emitLine("return result");
        });
    }

    protected emitSupportCode(): void {
        const map = Array.from(this._deserializerFunctions).map(
            f => [f, converterFunctionCodes[f]] as [ConverterFunction, string]
        );
        this.forEachWithBlankLines(map, ["interposing", 2], code => {
            this.emitMultiline(code);
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

    protected emitClosingCode(): void {
        this.forEachTopLevel(["interposing", 2], (t, name) => {
            const { fromDict, toDict } = defined(this._topLevelConverterNames.get(name));
            const pythonType = this.pythonType(t);
            this.emitBlock(["def ", fromDict, "(s: str) -> ", pythonType, ":"], () => {
                this.emitLine("return ", this.deserializer("s", t));
            });
            this.ensureBlankLine(2);
            this.emitBlock(["def ", toDict, "(x: ", pythonType, ") -> str:"], () => {
                this.emitLine("return ", this.serializer("x", t));
            });
        });
    }
}

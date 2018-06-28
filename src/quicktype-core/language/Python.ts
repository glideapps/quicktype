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
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Namer, funPrefixNamer, Name } from "../Naming";
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
import { assertNever, panic } from "../support/Support";
import { Sourcelike } from "../Source";
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
        mapping.set("date", "date-time");
        mapping.set("time", "date-time");
        mapping.set("date-time", "date-time");
        mapping.set("integer-string", "integer-string");
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
        return new PythonRenderer(this, renderContext);
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
    private imports: Map<string, Set<string>> = new Map();
    private declaredTypes: Set<Type> = new Set();

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
        this.emitBlock(this.declarationLine(t), () => {
            emitter();
        });
        this.declaredTypes.add(t);
    }

    protected emitClass(t: ClassType): void {
        this.declareType(t, () => {
            if (t.getProperties().size === 0) {
                this.emitLine("pass");
                return;
            }
            this.forEachClassProperty(t, "none", (name, _, cp) => {
                this.emitLine(name, ": ", this.pythonType(cp.type));
            });
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

    protected emitSourceStructure(_givenOutputFilename: string): void {
        const lines = this.gatherSource(() => {
            this.forEachDeclaration("interposing", decl => this.emitDeclaration(decl));
        });

        this.emitImports();
        this.ensureBlankLine();
        this.emitGatheredSource(lines);
    }
}

import { TargetLanguage } from "../TargetLanguage";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import {
    legalizeCharacters,
    splitIntoWords,
    isLetterOrUnderscoreOrDigit,
    combineWords,
    allLowerWordStyle,
    firstUpperWordStyle,
    intToHex,
    utf32ConcatMap,
    escapeNonPrintableMapper,
    isPrintable,
    isAscii,
    isLetterOrUnderscore
} from "../support/Strings";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { UnionType, Type, ClassType, EnumType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { Option } from "../RendererOptions";
import { RenderContext } from "../Renderer";

export class CrystalTargetLanguage extends TargetLanguage {
    protected makeRenderer(renderContext: RenderContext): CrystalRenderer {
        return new CrystalRenderer(this, renderContext);
    }

    constructor() {
        super("Crystal", ["crystal", "cr", "crystallang"], "cr");
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected getOptions(): Option<any>[] {
        return [];
    }
}

const keywords = [
    "Any",
    "Array",
    "Atomic",
    "Bool",
    "Channel",
    "Char",
    "Class",
    "Enum",
    "Enumerable",
    "Event",
    "Extern",
    "Exception",
    "File",
    "Float",
    "Float32",
    "Float64",
    "GC",
    "GZip",
    "Hash",
    "HTML",
    "HTTP",
    "Int",
    "Int128",
    "Int16",
    "Int32",
    "Int64",
    "Int8",
    "Iterable",
    "Link",
    "Logger",
    "Math",
    "Mutex",
    "Nil",
    "Number",
    "JSON",
    "IO",
    "Object",
    "Pointer",
    "Proc",
    "Process",
    "Range",
    "Random",
    "Regex",
    "Reference",
    "Set",
    "Signal",
    "Slice",
    "Spec",
    "StaticArray",
    "String",
    "Struct",
    "Symbol",
    "System",
    "TCPServer",
    "TCPSocket",
    "Socket",
    "Tempfile",
    "Termios",
    "Time",
    "Tuple",
    "ThreadLocal",
    "UDPSocket",
    "UInt128",
    "UInt16",
    "UInt32",
    "UInt64",
    "UInt8",
    "Union",
    "UNIXServer",
    "UNIXSocket",
    "UUID",
    "URI",
    "VaList",
    "Value",
    "Void",
    "WeakRef",
    "XML",
    "YAML",
    "Zip",
    "Zlib",
    "abstract",
    "alias",
    "as",
    "as?",
    "asm",
    "begin",
    "break",
    "case",
    "class",
    "def",
    "do",
    "else",
    "elsif",
    "end",
    "ensure",
    "enum",
    "extend",
    "false",
    "for",
    "fun",
    "if",
    "in",
    "include",
    "instance_sizeof",
    "is_a?",
    "lib",
    "macro",
    "module",
    "next",
    "nil",
    "nil?",
    "of",
    "out",
    "pointerof",
    "private",
    "protected",
    "require",
    "rescue",
    "return",
    "select",
    "self",
    "sizeof",
    "struct",
    "super",
    "then",
    "true",
    "type",
    "typeof",
    "uninitialized",
    "union",
    "unless",
    "until",
    "when",
    "while",
    "with",
    "yield"
];

function isAsciiLetterOrUnderscoreOrDigit(codePoint: number): boolean {
    if (!isAscii(codePoint)) {
        return false;
    }
    return isLetterOrUnderscoreOrDigit(codePoint);
}

function isAsciiLetterOrUnderscore(codePoint: number): boolean {
    if (!isAscii(codePoint)) {
        return false;
    }
    return isLetterOrUnderscore(codePoint);
}

const legalizeName = legalizeCharacters(isAsciiLetterOrUnderscoreOrDigit);

function crystalStyle(original: string, isSnakeCase: boolean): string {
    const words = splitIntoWords(original);

    const wordStyle = isSnakeCase ? allLowerWordStyle : firstUpperWordStyle;

    const combined = combineWords(
        words,
        legalizeName,
        wordStyle,
        wordStyle,
        wordStyle,
        wordStyle,
        isSnakeCase ? "_" : "",
        isAsciiLetterOrUnderscore
    );

    return combined === "_" ? "_underscore" : combined;
}

const snakeNamingFunction = funPrefixNamer("default", (original: string) => crystalStyle(original, true));
const camelNamingFunction = funPrefixNamer("camel", (original: string) => crystalStyle(original, false));

function standardUnicodeCrystalEscape(codePoint: number): string {
    if (codePoint <= 0xffff) {
        return "\\u{" + intToHex(codePoint, 4) + "}";
    } else {
        return "\\u{" + intToHex(codePoint, 6) + "}";
    }
}

const crystalStringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeCrystalEscape));

export class CrystalRenderer extends ConvenienceRenderer {
    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext) {
        super(targetLanguage, renderContext);
    }

    protected makeNamedTypeNamer(): Namer {
        return camelNamingFunction;
    }

    protected namerForObjectProperty(): Namer | null {
        return snakeNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer | null {
        return camelNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer | null {
        return camelNamingFunction;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected get commentLineStart(): string {
        return "# ";
    }

    private nullableCrystalType(t: Type, withIssues: boolean): Sourcelike {
        return [this.crystalType(t, withIssues), "?"];
    }

    protected isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    private crystalType(t: Type, withIssues = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "JSON::Any?"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Nil"),
            _boolType => "Bool",
            _integerType => "Int32",
            _doubleType => "Float64",
            _stringType => "String",
            arrayType => ["Array(", this.crystalType(arrayType.items, withIssues), ")"],
            classType => this.nameForNamedType(classType),
            mapType => ["Hash(String, ", this.crystalType(mapType.values, withIssues), ")"],
            _enumType => "String",
            unionType => {
                const nullable = nullableFromUnion(unionType);

                if (nullable !== null) return this.nullableCrystalType(nullable, withIssues);

                const [hasNull] = removeNullFromUnion(unionType);

                const name = this.nameForNamedType(unionType);

                return hasNull !== null ? ([name, "?"] as Sourcelike) : name;
            }
        );
    }

    private breakCycle(t: Type, withIssues: boolean): Sourcelike {
        return this.crystalType(t, withIssues);
    }

    private emitRenameAttribute(propName: Name, jsonName: string): void {
        const escapedName = crystalStringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer) {
            this.emitLine('@[JSON::Field(key: "', escapedName, '")]');
        }
    }

    protected emitStructDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));

        const structBody = () =>
            this.forEachClassProperty(c, "none", (name, jsonName, prop) => {
                this.ensureBlankLine();
                this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                this.emitRenameAttribute(name, jsonName);
                this.emitLine("property ", name, " : ", this.crystalType(prop.type, true));
            });

        this.emitBlock(["class ", className], structBody);
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line);
        this.indent(() => {
            this.emitLine("include JSON::Serializable");
        });
        this.ensureBlankLine();
        this.indent(f);
        this.emitLine("end");
    }

    protected emitEnum(line: Sourcelike, f: () => void): void {
        this.emitLine(line);
        this.indent(f);
        this.emitLine("end");
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));

        const [, nonNulls] = removeNullFromUnion(u);

        let types: Sourcelike[][] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_name, t) => {
            const crystalType = this.breakCycle(t, true);
            types.push([crystalType]);
        });

        this.emitLine([
            "alias ",
            unionName,
            " = ",
            types.map(r => r.map(sl => this.sourcelikeToString(sl))).join(" | ")
        ]);
    }

    protected emitTopLevelAlias(t: Type, name: Name): void {
        this.emitLine("alias ", name, " = ", this.crystalType(t));
    }

    protected emitLeadingComments(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            return;
        }
    }

    protected emitSourceStructure(): void {
        this.emitLeadingComments();
        this.ensureBlankLine();
        this.emitLine('require "json"');

        this.forEachTopLevel(
            "leading",
            (t, name) => this.emitTopLevelAlias(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        this.forEachObject("leading-and-interposing", (c: ClassType, name: Name) => this.emitStructDefinition(c, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnion(u, name));
    }
}

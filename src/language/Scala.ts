import { Type, EnumType, UnionType, ClassType } from "../Type";
import { matchType, nullableFromUnion, directlyReachableSingleNamedType } from "../TypeUtils";
import { TypeGraph } from "../TypeGraph";
import { Sourcelike } from "../Source";
import {
    utf16LegalizeCharacters,
    escapeNonPrintableMapper,
    utf16ConcatMap,
    standardUnicodeHexEscape,
    isAscii,
    isLetter,
    isDigit,
    splitIntoWords,
    combineWords,
    allUpperWordStyle,
    firstUpperWordStyle,
    allLowerWordStyle
} from "../Strings";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption, StringOption, Option } from "../RendererOptions";
import { defined, assert } from "../Support";

export class ScalaTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);
    // FIXME: Do this via a configurable named eventually.
    private readonly _packageOption = new StringOption("package", "Generated package name", "NAME", "io.quicktype");

    constructor() {
        super("Scala", ["scala"], "scala");
    }

    protected getOptions(): Option<any>[] {
        return [this._packageOption, this._justTypesOption];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return ScalaRenderer;
    }
}

const keywords = [
    "abstract",
    "case",
    "catch",
    "class",
    "def",
    "do",
    "else",
    "extends",
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
    "throw",
    "trait",
    "try",
    "true",
    "type",
    "val",
    "var",
    "while",
    "with",
    "yield"
];

const typeNamingFunction = funPrefixNamer("types", n => scalaNameStyle(true, false, n));
const propertyNamingFunction = funPrefixNamer("properties", n => scalaNameStyle(false, false, n));
const enumCaseNamingFunction = funPrefixNamer("enum-cases", n => scalaNameStyle(false, false, n));

export const stringEscape = utf16ConcatMap(escapeNonPrintableMapper(isAscii, standardUnicodeHexEscape));

function isStartCharacter(codePoint: number): boolean {
    if (codePoint === 0x5f) return true; // underscore
    return isAscii(codePoint) && isLetter(codePoint);
}

function isPartCharacter(codePoint: number): boolean {
    return isStartCharacter(codePoint) || (isAscii(codePoint) && isDigit(codePoint));
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function scalaNameStyle(startWithUpper: boolean, upperUnderscore: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        upperUnderscore ? allUpperWordStyle : startWithUpper ? firstUpperWordStyle : allLowerWordStyle,
        upperUnderscore ? allUpperWordStyle : firstUpperWordStyle,
        upperUnderscore || startWithUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        upperUnderscore ? "_" : "",
        isStartCharacter
    );
}

export class ScalaRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;

    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _packageName: string,
        private readonly _justTypes: boolean
    ) {
        super(targetLanguage, graph, leadingComments);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return typeNamingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return propertyNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return propertyNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return enumCaseNamingFunction;
    }

    protected unionNeedsName(u: UnionType): boolean {
        return nullableFromUnion(u) === null;
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        // If the top-level type doesn't contain any classes or unions
        // we have to define a class just for the `FromJson` method, in
        // emitFromJsonForTopLevel.
        return directlyReachableSingleNamedType(type);
    }

    protected startFile(basename: Sourcelike): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.scala`;
    }

    protected finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected scalaType(t: Type): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => "Any",
            _nullType => "Any",
            _boolType => "Boolean",
            _integerType => "Long",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => ["Seq[", this.scalaType(arrayType.items), "]"],
            classType => this.nameForNamedType(classType),
            mapType => ["Map[String, ", this.scalaType(mapType.values), "]"],
            enumType => {
                const name = this.nameForNamedType(enumType).toString();
                // TODO extract the name of the Enum here
                if (name === "[object Object]") return "Enum";
                else return name;
            },
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return "Option[" + this.scalaType(nullable) + "]";
                return "Any";
            }
        );
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitLine("case class ", className, "(");
        this.indent(() => {
            this.forEachClassProperty(c, "none", (name, _, p) => {
                // TODO remove last comma
                this.emitDescription(this.descriptionForType(p.type));
                this.emitLine(name, ": ", this.scalaType(p.type), ",");
                this.ensureBlankLine();
            });
        });
        this.emitLine(")");
        this.ensureBlankLine();
        this.emitLine("case object ", className, " {");
        this.emitLine("    val jsonReads: Reads[", className, "] = Json.reads[", className, "]");
        this.emitLine("    val jsonWrites: Writes[", className, "] = Json.writes[", className, "]");
        this.emitLine("}");
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("object ", enumName, " extends Enumeration {");
        this.indent(() => {
            this.ensureBlankLine();
            this.emitLine("type ", enumName, " = Value");
            this.ensureBlankLine();

            this.forEachEnumCase(e, "none", name => {
                this.emitLine("val ", name, ' = Value("', name, '")');
            });

            this.ensureBlankLine();
            this.emitLine("implicit val ", enumName, "Reads = Reads.enumNameReads(", enumName, ")");
            this.emitLine("implicit val ", enumName, "Writes = Writes.enumNameWrites");
        });
        this.emitLine("}");
    }

    protected emitSourceStructure(): void {
        this.startFile("Model.scala");
        this.ensureBlankLine();
        this.emitLine("import java.time._");
        this.emitLine("import play.api.libs.json._");
        this.ensureBlankLine();

        this.emitLine("// Add Play-Json to your build.sbt:");
        this.emitLine('// libraryDependencies += "com.typesafe.play" %% "play-json" % "2.6.7"');
        this.emitLine("// Read JSON with this:");
        this.emitLine("// val myObject = Json.parse(myJsonString).as[MyObject]");
        this.emitLine("// and write like this:");
        this.emitLine("// val myJsValue = Json.toJson(myObject)");

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            () => this.emitLine
        );

        this.finishFile();
    }
}

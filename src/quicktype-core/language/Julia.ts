// import { mapFirst } from "collection-utils";

import { TargetLanguage } from "../TargetLanguage";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import {
    legalizeCharacters,
    splitIntoWords,
    isLetterOrUnderscoreOrDigit,
    combineWords,
    allLowerWordStyle,
    firstUpperWordStyle,
    utf32ConcatMap,
    escapeNonPrintableMapper,
    isPrintable,
    isAscii,
    isLetterOrUnderscore,
    standardUnicodeHexEscape} from "../support/Strings";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { UnionType, Type, ClassType, EnumType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { Option } from "../RendererOptions";
// import { Option, getOptionValues } from "../RendererOptions";
// import { defined } from "../support/Support";
import { RenderContext } from "../Renderer";

export const juliaOptions = {};

export class JuliaTargetLanguage extends TargetLanguage {
    protected makeRenderer(renderContext: RenderContext, _untypedOptionValues: { [name: string]: any }): JuliaRenderer {
        return new JuliaRenderer(this, renderContext,
                            // getOptionValues(juliaOptions, untypedOptionValues)
                           );
    }

    constructor() {
        super("Julia", ["julia", "jl", "julialang"], "jl");
    }

    protected getOptions(): Option<any>[] {
        return [];
    }
}

const keywords = [
    // Special reserved identifiers used internally for elided lifetimes,
    // unnamed method parameters, crate root module, error recovery etc.

    // Keywords used in the language.
    "begin",
    "while",
    "if",
    "for",
    "try",
    "return",
    "break",
    "continue",
    "function",
    "macro",
    "quote",
    "let",
    "local",
    "global",
    "const",
    "do",
    "struct",
    "module",
    "baremodule",
    "using",
    "import",
    "export",
    "true",
    "false"
];

const isAsciiLetterOrUnderscoreOrDigit = (codePoint: number): boolean => {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscoreOrDigit(codePoint);
};

const isAsciiLetterOrUnderscore = (codePoint: number): boolean => {
    if (!isAscii(codePoint)) {
        return false;
    }

    return isLetterOrUnderscore(codePoint);
};

const legalizeName = legalizeCharacters(isAsciiLetterOrUnderscoreOrDigit);

function juliaStyle(original: string, isSnakeCase: boolean): string {
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

const snakeNamingFunction = funPrefixNamer("default", (original: string) => juliaStyle(original, true));
const camelNamingFunction = funPrefixNamer("camel", (original: string) => juliaStyle(original, false));

const standardUnicodeJuliaEscape = (codePoint: number): string => {
    if (codePoint === 0x24) {
        return "\\$";
    } else {
        return standardUnicodeHexEscape(codePoint);
    }
};

const juliaStringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeJuliaEscape));

export class JuliaRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        // private readonly _options: OptionValues<typeof juliaOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected makeNamedTypeNamer(): Namer {
        return camelNamingFunction;
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    protected canBeForwardDeclared(t: Type): boolean {
        const kind = t.kind;
        return kind === "class";
        // return kind === "class" || kind === "enum";
        // return false;
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

    private nullableJuliaType(t: Type, withIssues: boolean): Sourcelike {
        return ["Nullable{", this.breakCycle(t, withIssues), "}"];
    }

    protected isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    private juliaType(t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Any"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Nothing"),
            _boolType => "Bool",
            _integerType => "Int",
            _doubleType => "Float64",
            _stringType => "String",
            arrayType => ["Vector{", this.juliaType(arrayType.items, withIssues), "}"],
            classType => this.nameForNamedType(classType),
            mapType => ["Dict{String, ", this.juliaType(mapType.values, withIssues), "}"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);

                if (nullable !== null) return this.nullableJuliaType(nullable, withIssues);

                const [hasNull] = removeNullFromUnion(unionType);

                const isCycleBreaker = this.isCycleBreakerType(unionType);

                const name = isCycleBreaker
                    ? ["Box{", this.nameForNamedType(unionType), "}"]
                    : this.nameForNamedType(unionType);

                return hasNull !== null ? (["Option{", name, "}"] as Sourcelike) : name;
            }
        );
    }

    private breakCycle(t: Type, withIssues: boolean): any {
        const juliaType = this.juliaType(t, withIssues);
        const isCycleBreaker = this.isCycleBreakerType(t);

        return isCycleBreaker ? ["Box{", juliaType, "}"] : juliaType;
    }

    private emitRenameAttribute(propName: Name, jsonName: string) {
        const escapedName = juliaStringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer) {
            this.emitLine("(:", this.sourcelikeToString(propName), ", Symbol(\"", escapedName, "\")),");
        }
    }

    protected emitNameTranslation(c: ClassType, className: Name): void {
        const blankLines = "none";
        const self = this;
        this.emitLine("StructTypes.names(::Type{", className, "}) = (");
        this.indent(
            function() {
                self.forEachClassProperty(c, blankLines, (name, jsonName, _prop) => {
                // self.emitDescription(self.descriptionForClassProperty(c, jsonName));
                self.emitRenameAttribute(name, jsonName);
                });
            });
        this.emitLine(")");
    }

    // TODO
    protected hasRenames(_c: ClassType): boolean {
        // const blankLines = "none"
        // const self = this;
        // self.forEachClassProperty(c, blankLines, (name, jsonName, prop) => {
        //     const escapedName = juliaStringEscape(jsonName);
        //     const namesDiffer = this.sourcelikeToString(name) !== escapedName;
        // });
        return true;
    }

    protected emitStructDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));

        const blankLines = "none";
        const self = this;
        const structBody = function() {
            self.forEachClassProperty(c, blankLines, (name, jsonName, prop) => {
                self.emitDescription(self.descriptionForClassProperty(c, jsonName));
                self.emitLine(name, " :: ", self.breakCycle(prop.type, true));
            });
            self.ensureBlankLine();
            self.emitLine(className, "() = new()");
        };

        this.emitBlock(["mutable struct ", className], structBody);
        this.emitLine("StructTypes.StructType(::Type{", className, "}) = StructTypes.Mutable()");

        this.ensureBlankLine();
        if (this.hasRenames(c)) {
            this.emitNameTranslation(c, className);
        }
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line);
        this.indent(f);
        this.emitLine("end");
    }

    // TODO
    protected emitUnion(_u: UnionType, _unionName: Name): void {
        // const isMaybeWithSingleType = nullableFromUnion(u);

        // if (isMaybeWithSingleType !== null) {
        //     return;
        // }

        // this.emitDescription(this.descriptionForType(u));
        // const [, nonNulls] = removeNullFromUnion(u);

        // const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        // this.emitBlock(["pub enum ", unionName], () =>
        //     this.forEachUnionMember(u, nonNulls, blankLines, null, (fieldName, t) => {
        //         const rustType = this.breakCycle(t, true);
        //         this.emitLine([fieldName, "(", rustType, "),"]);
        //     })
        // );
    }

    // TODO
    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));

        const blankLines = "none";
        this.emitBlock(["@option ", enumName, " begin"], () =>
            this.forEachEnumCase(e, blankLines, (name, _jsonName) => {
                // this.emitRenameAttribute(name, jsonName);
                this.emitLine(name);
            })
        );
        // this.emitLine("@option(", enumName, ",");
        // this.forEachEnumCase(e, blankLines, (name, jsonName) => {
        //     // this.emitRenameAttribute(name, jsonName);
        //     this.emitLine(name, ",");
        // });
        // this.emitLine(")");
    }

    protected emitTopLevelAlias(t: Type, name: Name): void {
        this.emitLine("const ", name, " = ", this.juliaType(t));
    }

    protected emitLeadingComments(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            return;
        }

        // const topLevelName = defined(mapFirst(this.topLevels));
        this.emitMultiline(
            `# Example code that deserializes and serializes an object of type \"MyType\" from a string.
# using JSON3
# JSON3.read(str::String, MyType)
# JSON3.write(obj)`
        );
    }

    protected emitSourceStructure(): void {
        this.emitLeadingComments();
        this.ensureBlankLine();
        this.emitLine("using JSON3");
        this.emitLine("using StructTypes");
        this.emitLine("using Nullables");

        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
        this.forEachObject("leading-and-interposing", (c: ClassType, name: Name) => this.emitStructDefinition(c, name));
        // this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnion(u, name));

        this.forEachTopLevel(
            "leading",
            (t, name) => this.emitTopLevelAlias(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

    }
}

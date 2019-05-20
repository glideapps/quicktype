import { mapFirst } from "collection-utils";

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
import { BooleanOption, EnumOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { assert, defined } from "../support/Support";
import { RenderContext } from "../Renderer";

export enum Density {
    Normal,
    Dense
}

export enum Visibility {
    Private,
    Crate,
    Public
}

export const rustOptions = {
    density: new EnumOption("density", "Density", [["normal", Density.Normal], ["dense", Density.Dense]]),
    visibility: new EnumOption("visibility", "Field visibility", [
        ["private", Visibility.Private],
        ["crate", Visibility.Crate],
        ["public", Visibility.Public]
    ]),
    deriveDebug: new BooleanOption("derive-debug", "Derive Debug impl", false),
    multiFileOutput: new BooleanOption("multi-file-output", "Renders each top-level object in its own Go file", false)
};

export class RustTargetLanguage extends TargetLanguage {
    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): RustRenderer {
        return new RustRenderer(this, renderContext, getOptionValues(rustOptions, untypedOptionValues));
    }

    constructor() {
        super("Rust", ["rust", "rs", "rustlang"], "rs");
    }

    protected getOptions(): Option<any>[] {
        return [rustOptions.density, rustOptions.visibility, rustOptions.deriveDebug, rustOptions.multiFileOutput];
    }
}

const keywords = [
    // Special reserved identifiers used internally for elided lifetimes,
    // unnamed method parameters, crate root module, error recovery etc.
    "{{root}}",
    "$crate",

    // Keywords used in the language.
    "as",
    "box",
    "break",
    "const",
    "continue",
    "crate",
    "else",
    "enum",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "unsafe",
    "use",
    "where",
    "while",

    // Keywords reserved for future use.
    "abstract",
    "alignof",
    "become",
    "do",
    "final",
    "macro",
    "offsetof",
    "override",
    "priv",
    "proc",
    "pure",
    "sizeof",
    "typeof",
    "unsized",
    "virtual",
    "yield",

    // Weak keywords, have special meaning only in specific contexts.
    "catch",
    "default",
    "dyn",
    "'static",
    "union"
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

function rustStyle(original: string, isSnakeCase: boolean): string {
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

const snakeNamingFunction = funPrefixNamer("default", (original: string) => rustStyle(original, true));
const camelNamingFunction = funPrefixNamer("camel", (original: string) => rustStyle(original, false));

const standardUnicodeRustEscape = (codePoint: number): string => {
    if (codePoint <= 0xffff) {
        return "\\u{" + intToHex(codePoint, 4) + "}";
    } else {
        return "\\u{" + intToHex(codePoint, 6) + "}";
    }
};

const rustStringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, standardUnicodeRustEscape));

export class RustRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof rustOptions>
    ) {
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
        return "/// ";
    }

    private nullableRustType(t: Type, withIssues: boolean): Sourcelike {
        return ["Option<", this.breakCycle(t, withIssues), ">"];
    }

    protected isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    private rustType(t: Type, withIssues: boolean = false): Sourcelike {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "Option<serde_json::Value>"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Option<serde_json::Value>"),
            _boolType => "bool",
            _integerType => "i64",
            _doubleType => "f64",
            _stringType => "String",
            arrayType => ["Vec<", this.rustType(arrayType.items, withIssues), ">"],
            classType => this.nameForNamedType(classType),
            mapType => ["HashMap<String, ", this.rustType(mapType.values, withIssues), ">"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);

                if (nullable !== null) return this.nullableRustType(nullable, withIssues);

                const [hasNull] = removeNullFromUnion(unionType);

                const isCycleBreaker = this.isCycleBreakerType(unionType);

                const name = isCycleBreaker
                    ? ["Box<", this.nameForNamedType(unionType), ">"]
                    : this.nameForNamedType(unionType);

                return hasNull !== null ? (["Option<", name, ">"] as Sourcelike) : name;
            }
        );
    }

    private breakCycle(t: Type, withIssues: boolean): any {
        const rustType = this.rustType(t, withIssues);
        const isCycleBreaker = this.isCycleBreakerType(t);

        return isCycleBreaker ? ["Box<", rustType, ">"] : rustType;
    }

    private emitRenameAttribute(propName: Name, jsonName: string) {
        const escapedName = rustStringEscape(jsonName);
        const namesDiffer = this.sourcelikeToString(propName) !== escapedName;
        if (namesDiffer || this._options.density === Density.Normal) {
            this.emitLine('#[serde(rename = "', escapedName, '")]');
        }
    }

    private get visibility(): string {
        if (this._options.visibility === Visibility.Crate) {
            return "pub(crate) ";
        } else if (this._options.visibility === Visibility.Public) {
            return "pub ";
        }
        return "";
    }

    /// startFile takes a file name, lowercases it, appends ".rs" to it, and sets it as the current filename.
    protected startFile(basename: Sourcelike): void {
        if (this._options.multiFileOutput === false) {
            return;
        }

        assert(this._currentFilename === undefined, "Previous file wasn't finished: " + this._currentFilename);
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.rs`.toLowerCase();
        this.initializeEmitContextForFilename(this._currentFilename);
    }

    /// endFile pushes the current file name onto the collection of finished files and then resets the current file name. These finished files are used in index.ts to write the output.
    protected endFile(): void {
        if (this._options.multiFileOutput === false) {
            return;
        }

        this.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected emitStructDefinition(c: ClassType, className: Name): void {
        this.startFile(className);
        this.emitLeadingComments(this.sourcelikeToString(className));
        this.emitLineOnce("extern crate serde_json;");
        if (this.haveMaps) {
            this.emitLineOnce("use std::collections::HashMap;");
        }

        this.emitDescription(this.descriptionForType(c));
        this.emitLine("#[derive(", this._options.deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");

        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        const structBody = () =>
            this.forEachClassProperty(c, blankLines, (name, jsonName, prop) => {
                this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                this.emitRenameAttribute(name, jsonName);
                this.emitLine(this.visibility, name, ": ", this.breakCycle(prop.type, true), ",");
            });

        this.emitBlock(["pub struct ", className], structBody);
        this.endFile();
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        this.startFile(unionName);
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitLineOnce("extern crate serde_json;");
        if (this.haveMaps) {
            this.emitLineOnce("use std::collections::HashMap;");
        }
        this.emitDescription(this.descriptionForType(u));
        this.emitLine("#[derive(", this._options.deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");
        this.emitLine("#[serde(untagged)]");

        const [, nonNulls] = removeNullFromUnion(u);

        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", unionName], () =>
            this.forEachUnionMember(u, nonNulls, blankLines, null, (fieldName, t) => {
                const rustType = this.breakCycle(t, true);
                this.emitLine([fieldName, "(", rustType, "),"]);
            })
        );
        this.endFile();
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.startFile(enumName);
        this.emitDescription(this.descriptionForType(e));
        this.emitLineOnce("extern crate serde_json;");
        if (this.haveMaps) {
            this.emitLineOnce("use std::collections::HashMap;");
        }
        this.emitLine("#[derive(", this._options.deriveDebug ? "Debug, " : "", "Serialize, Deserialize)]");

        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", enumName], () =>
            this.forEachEnumCase(e, blankLines, (name, jsonName) => {
                this.emitRenameAttribute(name, jsonName);
                this.emitLine([name, ","]);
            })
        );
        this.endFile();
    }

    protected emitTopLevelAlias(t: Type, name: Name): void {
        this.emitLine("pub type ", name, " = ", this.rustType(t), ";");
    }

    protected emitLeadingComments(objectName: string): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
            return;
        }

        this.emitMultiline(
            `// Example code that deserializes and serializes the model.
// extern crate serde;
// #[macro_use]
// extern crate serde_derive;
// extern crate serde_json;
//
// use generated_module::${objectName};
//
// fn main() {
//     let json = r#"{"answer": 42}"#;
//     let model: ${objectName} = serde_json::from_str(&json).unwrap();
// }`
        );
        this.ensureBlankLine();
    }

    protected emitHelperFunctions(): void {
        this.startFile("jsonschemasupport");
        if (this.haveMaps) {
            this.emitLineOnce("use std::collections::HashMap;");
        }
        this.forEachTopLevel(
            "leading",
            (t, name) => this.emitTopLevelAlias(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );
        this.endFile();
    }

    protected emitSourceStructure(): void {
        if (this._options.multiFileOutput === false) {
            const topLevelName = defined(mapFirst(this.topLevels));
            if (topLevelName !== undefined) {
                this.emitLeadingComments(`${topLevelName}`);
            }
        }

        this.emitHelperFunctions();

        this.forEachObject("leading-and-interposing", (c: ClassType, name: Name) => this.emitStructDefinition(c, name));
        this.forEachUnion("leading-and-interposing", (u, name) => this.emitUnion(u, name));
        this.forEachEnum("leading-and-interposing", (e, name) => this.emitEnumDefinition(e, name));
    }
}

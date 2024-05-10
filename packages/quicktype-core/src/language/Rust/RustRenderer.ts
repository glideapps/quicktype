/* eslint-disable @typescript-eslint/naming-convention */
import { mapFirst } from "collection-utils";

import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../../Annotation";
import { ConvenienceRenderer, type ForbiddenWordsInfo } from "../../ConvenienceRenderer";
import { type Name, type Namer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, maybeAnnotated } from "../../Source";
import { defined } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import { type ClassType, type EnumType, type Type, UnionType } from "../../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../../TypeUtils";

import { keywords } from "./constants";
import { type rustOptions } from "./language";
import {
    Density,
    type NamingStyleKey,
    Visibility,
    camelNamingFunction,
    getPreferredNamingStyle,
    listMatchingNamingStyles,
    nameWithNamingStyle,
    namingStyles,
    rustStringEscape,
    snakeNamingFunction
} from "./utils";

export class RustRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _options: OptionValues<typeof rustOptions>
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

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
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

    protected nullableRustType(t: Type, withIssues: boolean): Sourcelike {
        return ["Option<", this.breakCycle(t, withIssues), ">"];
    }

    protected isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    protected rustType(t: Type, withIssues = false): Sourcelike {
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

    protected emitDeriveHeader(): void {
        this.emitLine(
            "#[derive(",
            this._options.deriveDebug ? "Debug, " : "",
            this._options.deriveClone ? "Clone, " : "",
            this._options.derivePartialEq ? "PartialEq, " : "",
            "Serialize, Deserialize)]"
        );
    }

    protected breakCycle(t: Type, withIssues: boolean): Sourcelike {
        const rustType = this.rustType(t, withIssues);
        const isCycleBreaker = this.isCycleBreakerType(t);

        return isCycleBreaker ? ["Box<", rustType, ">"] : rustType;
    }

    protected emitRenameAttribute(
        propName: Name,
        jsonName: string,
        defaultNamingStyle: NamingStyleKey,
        preferredNamingStyle: NamingStyleKey
    ): void {
        const escapedName = rustStringEscape(jsonName);
        const name = namingStyles[defaultNamingStyle].fromParts(this.sourcelikeToString(propName).split(" "));
        const styledName = nameWithNamingStyle(name, preferredNamingStyle);
        const namesDiffer = escapedName !== styledName;
        if (namesDiffer) {
            this.emitLine('#[serde(rename = "', escapedName, '")]');
        }
    }

    protected emitSkipSerializeNone(t: Type): void {
        if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable !== null) this.emitLine('#[serde(skip_serializing_if = "Option::is_none")]');
        }
    }

    protected get visibility(): string {
        if (this._options.visibility === Visibility.Crate) {
            return "pub(crate) ";
        } else if (this._options.visibility === Visibility.Public) {
            return "pub ";
        }

        return "";
    }

    protected emitStructDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitDeriveHeader();

        // List the possible naming styles for every class property
        const propertiesNamingStyles: { [key: string]: string[] } = {};
        this.forEachClassProperty(c, "none", (_name, jsonName, _prop) => {
            propertiesNamingStyles[jsonName] = listMatchingNamingStyles(jsonName);
        });

        // Set the default naming style on the struct
        const defaultStyle = "snake_case";
        const preferredNamingStyle = getPreferredNamingStyle(
            Object.values(propertiesNamingStyles).flat(),
            defaultStyle
        );
        if (preferredNamingStyle !== defaultStyle) {
            this.emitLine(`#[serde(rename_all = "${preferredNamingStyle}")]`);
        }

        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        const structBody = (): void =>
            this.forEachClassProperty(c, blankLines, (name, jsonName, prop) => {
                this.emitDescription(this.descriptionForClassProperty(c, jsonName));
                this.emitRenameAttribute(name, jsonName, defaultStyle, preferredNamingStyle);
                if (this._options.skipSerializingNone) {
                    this.emitSkipSerializeNone(prop.type);
                }

                this.emitLine(this.visibility, name, ": ", this.breakCycle(prop.type, true), ",");
            });

        this.emitBlock(["pub struct ", className], structBody);
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));
        this.emitDeriveHeader();
        this.emitLine("#[serde(untagged)]");

        const [, nonNulls] = removeNullFromUnion(u);

        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", unionName], () =>
            this.forEachUnionMember(u, nonNulls, blankLines, null, (fieldName, t) => {
                const rustType = this.breakCycle(t, true);
                this.emitLine([fieldName, "(", rustType, "),"]);
            })
        );
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.emitDeriveHeader();

        // List the possible naming styles for every enum case
        const enumCasesNamingStyles: { [key: string]: string[] } = {};
        this.forEachEnumCase(e, "none", (_name, jsonName) => {
            enumCasesNamingStyles[jsonName] = listMatchingNamingStyles(jsonName);
        });

        // Set the default naming style on the enum
        const defaultStyle = "PascalCase";
        const preferredNamingStyle = getPreferredNamingStyle(Object.values(enumCasesNamingStyles).flat(), defaultStyle);
        if (preferredNamingStyle !== defaultStyle) {
            this.emitLine(`#[serde(rename_all = "${preferredNamingStyle}")]`);
        }

        const blankLines = this._options.density === Density.Dense ? "none" : "interposing";
        this.emitBlock(["pub enum ", enumName], () =>
            this.forEachEnumCase(e, blankLines, (name, jsonName) => {
                this.emitRenameAttribute(name, jsonName, defaultStyle, preferredNamingStyle);
                this.emitLine([name, ","]);
            })
        );
    }

    protected emitTopLevelAlias(t: Type, name: Name): void {
        this.emitLine("pub type ", name, " = ", this.rustType(t), ";");
    }

    protected emitLeadingComments(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
            return;
        }

        const topLevelName = defined(mapFirst(this.topLevels)).getCombinedName();
        this.emitMultiline(
            `// Example code that deserializes and serializes the model.
// extern crate serde;
// #[macro_use]
// extern crate serde_derive;
// extern crate serde_json;
//
// use generated_module::${topLevelName};
//
// fn main() {
//     let json = r#"{"answer": 42}"#;
//     let model: ${topLevelName} = serde_json::from_str(&json).unwrap();
// }`
        );
    }

    protected emitSourceStructure(): void {
        if (this._options.leadingComments) {
            this.emitLeadingComments();
        }

        this.ensureBlankLine();
        if (this._options.edition2018) {
            this.emitLine("use serde::{Serialize, Deserialize};");
        } else {
            this.emitLine("extern crate serde_derive;");
        }

        if (this.haveMaps) {
            this.emitLine("use std::collections::HashMap;");
        }

        this.forEachTopLevel(
            "leading",
            (t, name) => this.emitTopLevelAlias(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, name: Name) => this.emitStructDefinition(c, name),
            (e, name) => this.emitEnumDefinition(e, name),
            (u, name) => this.emitUnion(u, name)
        );
    }
}

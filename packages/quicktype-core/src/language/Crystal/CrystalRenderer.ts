import {
    anyTypeIssueAnnotation,
    nullTypeIssueAnnotation,
} from "../../Annotation";
import {
    ConvenienceRenderer,
    type ForbiddenWordsInfo,
} from "../../ConvenienceRenderer";
import { type Name, type Namer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type Sourcelike, maybeAnnotated } from "../../Source";
import { type TargetLanguage } from "../../TargetLanguage";
import {
    type ClassType,
    type EnumType,
    type Type,
    type UnionType,
} from "../../Type";
import {
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils";

import { keywords } from "./constants";
import {
    camelNamingFunction,
    crystalStringEscape,
    snakeNamingFunction,
} from "./utils";

export class CrystalRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
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

    protected forbiddenForObjectProperties(
        _c: ClassType,
        _className: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(
        _u: UnionType,
        _unionName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(
        _e: EnumType,
        _enumName: Name,
    ): ForbiddenWordsInfo {
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
            (_anyType) =>
                maybeAnnotated(
                    withIssues,
                    anyTypeIssueAnnotation,
                    "JSON::Any?",
                ),
            (_nullType) =>
                maybeAnnotated(withIssues, nullTypeIssueAnnotation, "Nil"),
            (_boolType) => "Bool",
            (_integerType) => "Int32",
            (_doubleType) => "Float64",
            (_stringType) => "String",
            (arrayType) => [
                "Array(",
                this.crystalType(arrayType.items, withIssues),
                ")",
            ],
            (classType) => this.nameForNamedType(classType),
            (mapType) => [
                "Hash(String, ",
                this.crystalType(mapType.values, withIssues),
                ")",
            ],
            (_enumType) => "String",
            (unionType) => {
                const nullable = nullableFromUnion(unionType);

                if (nullable !== null)
                    return this.nullableCrystalType(nullable, withIssues);

                const [hasNull] = removeNullFromUnion(unionType);

                const name = this.nameForNamedType(unionType);

                return hasNull !== null ? ([name, "?"] as Sourcelike) : name;
            },
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

        const structBody = (): void =>
            this.forEachClassProperty(c, "none", (name, jsonName, prop) => {
                this.ensureBlankLine();
                this.emitDescription(
                    this.descriptionForClassProperty(c, jsonName),
                );
                this.emitRenameAttribute(name, jsonName);
                this.emitLine(
                    "property ",
                    name,
                    " : ",
                    this.crystalType(prop.type, true),
                );
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
            types
                .map((r) => r.map((sl) => this.sourcelikeToString(sl)))
                .join(" | "),
        ]);
    }

    protected emitTopLevelAlias(t: Type, name: Name): void {
        this.emitLine("alias ", name, " = ", this.crystalType(t));
    }

    protected emitLeadingComments(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
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
            (t) => this.namedTypeToNameForTopLevel(t) === undefined,
        );

        this.forEachObject(
            "leading-and-interposing",
            (c: ClassType, name: Name) => this.emitStructDefinition(c, name),
        );
        this.forEachUnion("leading-and-interposing", (u, name) =>
            this.emitUnion(u, name),
        );
    }
}

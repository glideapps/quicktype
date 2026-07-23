import _ from "lodash";

import {
    anyTypeIssueAnnotation,
    nullTypeIssueAnnotation,
} from "../../Annotation.js";
import {
    ConvenienceRenderer,
    type ForbiddenWordsInfo,
} from "../../ConvenienceRenderer.js";
import {
    DependencyName,
    type Name,
    type Namer,
    funPrefixNamer,
} from "../../Naming.js";
import type { RenderContext } from "../../Renderer.js";
import type { OptionValues } from "../../RendererOptions/index.js";
import { type Sourcelike, maybeAnnotated } from "../../Source.js";
import { acronymStyle } from "../../support/Acronyms.js";
import { defined } from "../../support/Support.js";
import type { TargetLanguage } from "../../TargetLanguage.js";
import {
    type ClassProperty,
    type ClassType,
    type EnumType,
    type Type,
    UnionType,
} from "../../Type/index.js";
import {
    directlyReachableSingleNamedType,
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils.js";

import type { phpOptions } from "./language.js";
import { phpForbiddenClassNames, phpNameStyle, stringEscape } from "./utils.js";

export interface FunctionNames {
    readonly from: Name;
    readonly getter: Name;
    readonly sample: Name;
    readonly setter: Name;
    readonly to: Name;
    readonly validate: Name;
}

export class PhpRenderer extends ConvenienceRenderer {
    private readonly _gettersAndSettersForPropertyName = new Map<
        Name,
        FunctionNames
    >();

    private _haveEmittedLeadingComments = false;

    protected readonly _converterClassname: string = "Converter";

    protected readonly _converterKeywords: string[] = [];

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        protected readonly _options: OptionValues<typeof phpOptions>,
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return phpForbiddenClassNames;
    }

    protected forbiddenForObjectProperties(
        _c: ClassType,
        _className: Name,
    ): ForbiddenWordsInfo {
        // `$this` is the only variable name PHP reserves; a property named
        // "this" would produce an illegal `$this` constructor parameter.
        return { names: ["this"], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return this.getNameStyling("typeNamingFunction");
    }

    protected namerForObjectProperty(): Namer {
        return this.getNameStyling("propertyNamingFunction");
    }

    protected makeUnionMemberNamer(): Namer {
        return this.getNameStyling("propertyNamingFunction");
    }

    protected makeEnumCaseNamer(): Namer {
        return this.getNameStyling("enumCaseNamingFunction");
    }

    protected unionNeedsName(_u: UnionType): boolean {
        // Unions are represented inline as PHP union type declarations;
        // no named type is ever emitted for them.
        return false;
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return directlyReachableSingleNamedType(type);
    }

    protected makeNamesForPropertyGetterAndSetter(
        _c: ClassType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        name: Name,
    ): FunctionNames {
        const getterName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `get_${lookup(name)}`,
        );
        const setterName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `set_${lookup(name)}`,
        );
        const validateName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `validate_${lookup(name)}`,
        );
        const fromName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `from_${lookup(name)}`,
        );
        const toName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `to_${lookup(name)}`,
        );
        const sampleName = new DependencyName(
            this.getNameStyling("propertyNamingFunction"),
            name.order,
            (lookup) => `sample_${lookup(name)}`,
        );
        return {
            getter: getterName,
            setter: setterName,
            validate: validateName,
            from: fromName,
            to: toName,
            sample: sampleName,
        };
    }

    protected makePropertyDependencyNames(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        name: Name,
    ): Name[] {
        const getterAndSetterNames = this.makeNamesForPropertyGetterAndSetter(
            c,
            className,
            p,
            jsonName,
            name,
        );
        this._gettersAndSettersForPropertyName.set(name, getterAndSetterNames);
        return [
            getterAndSetterNames.getter,
            getterAndSetterNames.setter,
            getterAndSetterNames.validate,
            getterAndSetterNames.to,
            getterAndSetterNames.from,
            getterAndSetterNames.sample,
        ];
    }

    private getNameStyling(convention: string): Namer {
        const styling: { [key: string]: Namer } = {
            typeNamingFunction: funPrefixNamer("types", (n) =>
                phpNameStyle(
                    true,
                    false,
                    n,
                    acronymStyle(this._options.acronymStyle),
                ),
            ),
            propertyNamingFunction: funPrefixNamer("properties", (n) =>
                phpNameStyle(
                    false,
                    false,
                    n,
                    acronymStyle(this._options.acronymStyle),
                ),
            ),
            enumCaseNamingFunction: funPrefixNamer("enum-cases", (n) =>
                phpNameStyle(
                    true,
                    true,
                    n,
                    acronymStyle(this._options.acronymStyle),
                ),
            ),
        };
        return styling[convention];
    }

    protected startFile(_basename: Sourcelike): void {
        this.ensureBlankLine();
        if (
            !this._haveEmittedLeadingComments &&
            this.leadingComments !== undefined
        ) {
            this.emitComments(this.leadingComments);
            this.ensureBlankLine();
            this._haveEmittedLeadingComments = true;
        }
    }

    protected finishFile(): void {
        // empty
    }

    protected emitFileHeader(fileName: Sourcelike, _imports: string[]): void {
        this.startFile(fileName);
        this.emitLine("// This is an autogenerated file:", fileName);
        this.ensureBlankLine();
    }

    public emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, {
            lineStart: " * ",
            beforeComment: "/**",
            afterComment: " */",
        });
    }

    private emitDocBlockDescription(desc: string[] | undefined): void {
        if (desc === undefined) {
            this.emitLine("/**");
            return;
        }

        this.emitCommentLines(desc, {
            lineStart: " * ",
            beforeComment: "/**",
        });
        this.emitLine(" *");
    }

    public emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    // Union members in runtime-dispatch order: the most specific check
    // first, so that e.g. an int matches an integer member before a double
    // member, and class instances are tested before the stdClass check a
    // map member uses.  `any` goes last because it matches everything.
    private sortedUnionMembers(u: UnionType): {
        members: readonly Type[];
        nullType: Type | null;
    } {
        const order = [
            "class",
            "enum",
            "date-time",
            "uuid",
            "map",
            "array",
            "bool",
            "integer",
            "double",
            "string",
        ];
        const [nullType, nonNulls] = removeNullFromUnion(u, (t) => {
            const i = order.indexOf(t.kind);
            return i === -1 ? order.length : i;
        });
        return { members: Array.from(nonNulls), nullType };
    }

    // The PHP union type declaration for a non-nullable union, e.g.
    // `MixedClass|int|string` (requires PHP 8.0).  With `jsonSide` the
    // types are those of the decoded JSON value instead, where classes
    // and maps are stdClass and enums and dates are strings.
    protected phpUnionType(u: UnionType, jsonSide: boolean): Sourcelike {
        const labels: Record<string, string> = jsonSide
            ? {
                  any: "mixed",
                  array: "array",
                  bool: "bool",
                  class: "stdClass",
                  "date-time": "string",
                  double: "float",
                  enum: "string",
                  integer: "int",
                  map: "stdClass",
                  string: "string",
                  uuid: "string",
              }
            : {
                  any: "mixed",
                  array: "array",
                  bool: "bool",
                  "date-time": "DateTime",
                  double: "float",
                  integer: "int",
                  map: "stdClass",
                  string: "string",
                  uuid: "string",
              };
        const { members, nullType } = this.sortedUnionMembers(u);
        const parts: Sourcelike[] = [];
        const seen = new Set<string>();
        for (const member of members) {
            let hint: Sourcelike;
            const label = labels[member.kind];
            if (label !== undefined) {
                // Members can render to the same PHP type, like a string
                // and a UUID member — mention it only once.
                if (seen.has(label)) continue;
                seen.add(label);
                hint = label;
            } else if (member.kind === "class" || member.kind === "enum") {
                hint = this.nameForNamedType(member);
            } else {
                throw new Error(
                    `PHP cannot represent union member type "${member.kind}"`,
                );
            }

            if (parts.length > 0) parts.push("|");
            parts.push(hint);
        }

        if (nullType !== null) parts.push("|null");
        return parts;
    }

    // The runtime check deciding whether a value is this union member.
    // Returns null for `any`, which matches everything.  With `jsonSide`
    // the value is a decoded JSON value instead of a PHP-side one.
    private unionMemberTypeCheck(
        t: Type,
        expr: Sourcelike[],
        jsonSide: boolean,
    ): Sourcelike[] | null {
        switch (t.kind) {
            case "null":
                return ["is_null(", ...expr, ")"];
            case "bool":
                return ["is_bool(", ...expr, ")"];
            case "integer":
                return ["is_int(", ...expr, ")"];
            case "double":
                // PHP integers are acceptable wherever floats are.
                return ["is_float(", ...expr, ") || is_int(", ...expr, ")"];
            case "string":
            case "uuid":
                return ["is_string(", ...expr, ")"];
            case "date-time":
                return jsonSide
                    ? ["is_string(", ...expr, ")"]
                    : [...expr, " instanceof DateTime"];
            case "enum": {
                if (!jsonSide) {
                    return [...expr, " instanceof ", this.nameForNamedType(t)];
                }

                // On the JSON side an enum value is a string, but a plain
                // string member may share the union, so check membership in
                // the enum's values rather than just `is_string`.
                const check: Sourcelike[] = [
                    "is_string(",
                    ...expr,
                    ") && in_array(",
                    ...expr,
                    ", [",
                ];
                let first = true;
                for (const jsonName of (t as EnumType).cases) {
                    if (!first) check.push(", ");
                    check.push("'", stringEscape(jsonName), "'");
                    first = false;
                }
                check.push("], true)");
                return check;
            }
            case "class":
                return jsonSide
                    ? ["is_object(", ...expr, ")"]
                    : [...expr, " instanceof ", this.nameForNamedType(t)];
            case "map":
                return jsonSide
                    ? ["is_object(", ...expr, ")"]
                    : [...expr, " instanceof stdClass"];
            case "array":
                return ["is_array(", ...expr, ")"];
            case "any":
                return null;
            default:
                throw new Error(
                    `PHP cannot check for union member type "${t.kind}"`,
                );
        }
    }

    // Emits an if/elseif chain over the union's members, dispatching on
    // the runtime type of `expr`, with `emitNoMatch` as the else branch.
    private emitUnionDispatch(
        u: UnionType,
        expr: Sourcelike[],
        jsonSide: boolean,
        emitMember: (t: Type) => void,
        emitNoMatch: () => void,
    ): void {
        const { members, nullType } = this.sortedUnionMembers(u);
        const all = nullType === null ? members : [nullType, ...members];
        let first = true;
        let haveCatchAll = false;
        for (const member of all) {
            const check = this.unionMemberTypeCheck(member, expr, jsonSide);
            if (check === null) {
                if (first) {
                    emitMember(member);
                    return;
                }

                this.emitLine("} else {");
                this.indent(() => emitMember(member));
                haveCatchAll = true;
                break;
            }

            this.emitLine(first ? "if (" : "} elseif (", ...check, ") {");
            first = false;
            this.indent(() => emitMember(member));
        }

        if (!haveCatchAll) {
            this.emitLine("} else {");
            this.indent(emitNoMatch);
        }

        this.emitLine("}");
    }

    protected phpType(
        _reference: boolean,
        t: Type,
        isOptional = false,
        prefix = "?",
        suffix = "",
    ): Sourcelike {
        function optionalize(s: Sourcelike): Sourcelike {
            return [isOptional ? prefix : "", s, isOptional ? suffix : ""];
        }

        return matchType<Sourcelike>(
            t,
            (_anyType) =>
                maybeAnnotated(isOptional, anyTypeIssueAnnotation, "mixed"),
            (_nullType) =>
                maybeAnnotated(isOptional, nullTypeIssueAnnotation, "mixed"),
            (_boolType) => optionalize("bool"),
            (_integerType) => optionalize("int"),
            (_doubleType) => optionalize("float"),
            (_stringType) => optionalize("string"),
            (_arrayType) => optionalize("array"),
            (classType) => optionalize(this.nameForNamedType(classType)),
            (_mapType) => optionalize("stdClass"),
            (enumType) => optionalize(this.nameForNamedType(enumType)),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null)
                    return this.phpType(true, nullable, true, prefix, suffix);
                return this.phpUnionType(unionType, false);
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "time") {
                    throw new Error('transformedStringType.kind === "time"');
                }

                if (transformedStringType.kind === "date") {
                    throw new Error('transformedStringType.kind === "date"');
                }

                if (transformedStringType.kind === "date-time") {
                    return optionalize("DateTime");
                }

                return optionalize("string");
            },
        );
    }

    protected phpDocConvertType(className: Name, t: Type): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => "any",
            (_nullType) => "null",
            (_boolType) => "bool",
            (_integerType) => "int",
            (_doubleType) => "float",
            (_stringType) => "string",
            (arrayType) => {
                const itemsDoc = this.phpDocConvertType(
                    className,
                    arrayType.items,
                );
                if (
                    arrayType.items instanceof UnionType &&
                    nullableFromUnion(arrayType.items) === null
                ) {
                    return ["(", itemsDoc, ")[]"];
                }

                return [itemsDoc, "[]"];
            },
            (_classType) => _classType.getCombinedName(),
            (_mapType) => "stdClass",
            (enumType) => this.nameForNamedType(enumType),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return [
                        this.phpDocConvertType(className, nullable),
                        "|null",
                    ];
                }

                return this.phpUnionType(unionType, false);
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    return "DateTime";
                }

                if (transformedStringType.kind === "uuid") {
                    return "string";
                }

                throw new Error('transformedStringType.kind === "unknown"');
            },
        );
    }

    protected phpConvertType(className: Name, t: Type): Sourcelike {
        return matchType<Sourcelike>(
            t,
            (_anyType) => "mixed",
            (_nullType) => "mixed",
            (_boolType) => "bool",
            (_integerType) => "int",
            (_doubleType) => "float",
            (_stringType) => "string",
            (_arrayType) => "array",
            (_classType) => "stdClass",
            (_mapType) => "stdClass",
            (_enumType) => "string", // TODO number this.nameForNamedType(enumType),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return ["?", this.phpConvertType(className, nullable)];
                }

                return this.phpUnionType(unionType, true);
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    return "string";
                }

                if (transformedStringType.kind === "uuid") {
                    return "string";
                }

                throw new Error('transformedStringType.kind === "unknown"');
            },
        );
    }

    protected phpToObjConvert(
        className: Name,
        t: Type,
        lhs: Sourcelike[],
        args: Sourcelike[],
    ): void {
        matchType(
            t,
            (_anyType) => this.emitLine(...lhs, ...args, "; /*any*/"),
            (_nullType) => this.emitLine(...lhs, ...args, "; /*null*/"),
            (_boolType) => this.emitLine(...lhs, ...args, "; /*bool*/"),
            (_integerType) => this.emitLine(...lhs, ...args, "; /*int*/"),
            (_doubleType) => this.emitLine(...lhs, ...args, "; /*float*/"),
            (_stringType) => this.emitLine(...lhs, ...args, "; /*string*/"),
            (arrayType) => {
                this.emitLine(...lhs, "array_map(function ($value) {");
                this.indent(() => {
                    this.phpToObjConvert(
                        className,
                        arrayType.items,
                        ["return "],
                        ["$value"],
                    );
                    // this.emitLine("return $tmp;");
                });
                this.emitLine("}, ", ...args, ");");
            },
            (_classType) =>
                this.emitLine(...lhs, ...args, "->to(); ", "/*class*/"),
            (mapType) => {
                this.emitLine("$out = new stdClass();");
                this.emitBlock(["foreach (", ...args, " as $k => $v)"], () => {
                    this.phpToObjConvert(
                        className,
                        mapType.values,
                        ["$out->$k = "],
                        ["$v"],
                    );
                });
                this.emitLine("return $out;");
            },
            (enumType) =>
                this.emitLine(
                    ...lhs,
                    this.nameForNamedType(enumType),
                    "::to(",
                    ...args,
                    "); ",
                    "/*enum*/",
                ),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitLine("if (!is_null(", ...args, ")) {");
                    this.indent(() =>
                        this.phpToObjConvert(className, nullable, lhs, args),
                    );
                    this.emitLine("} else {");
                    this.indent(() => this.emitLine(...lhs, " null;"));
                    this.emitLine("}");
                    return;
                }

                this.emitUnionDispatch(
                    unionType,
                    args,
                    false,
                    (member) =>
                        this.phpToObjConvert(className, member, lhs, args),
                    () =>
                        this.emitLine(
                            "throw new Exception('Union value has no matching member in ",
                            className,
                            "');",
                        ),
                );
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    this.emitLine(
                        ...lhs,
                        ...args,
                        "->format(DateTimeInterface::ISO8601);",
                    );
                    return;
                }

                if (transformedStringType.kind === "uuid") {
                    this.emitLine(...lhs, ...args, "; /*uuid*/");
                    return;
                }

                throw new Error('transformedStringType.kind === "unknown"');
            },
        );
    }

    private transformDateTime(
        className: Name,
        attrName: Sourcelike,
        scopeAttrName: Sourcelike[],
    ): void {
        this.emitBlock(["if (!is_a(", scopeAttrName, ", 'DateTime'))"], () =>
            this.emitLine(
                "throw new Exception('Attribute Error:",
                className,
                "::",
                attrName,
                "');",
            ),
        );
        // if (lhs !== undefined) {
        //     this.emitLine(lhs, "$tmp;");
        // }
    }

    protected phpFromObjConvert(
        className: Name,
        t: Type,
        lhs: Sourcelike[],
        args: Sourcelike[],
    ): void {
        matchType(
            t,
            (_anyType) => this.emitLine(...lhs, ...args, "; /*any*/"),
            (_nullType) => this.emitLine(...lhs, ...args, "; /*null*/"),
            (_boolType) => this.emitLine(...lhs, ...args, "; /*bool*/"),
            (_integerType) => this.emitLine(...lhs, ...args, "; /*int*/"),
            (_doubleType) => this.emitLine(...lhs, ...args, "; /*float*/"),
            (_stringType) => this.emitLine(...lhs, ...args, "; /*string*/"),
            (arrayType) => {
                this.emitLine(...lhs, " array_map(function ($value) {");
                this.indent(() => {
                    this.phpFromObjConvert(
                        className,
                        arrayType.items,
                        ["return "],
                        ["$value"],
                    );
                    // this.emitLine("return $tmp;");
                });
                this.emitLine("}, ", ...args, ");");
            },
            (classType) =>
                this.emitLine(
                    ...lhs,
                    this.nameForNamedType(classType),
                    "::from(",
                    ...args,
                    "); ",
                    "/*class*/",
                ),
            (mapType) => {
                this.emitLine("$out = new stdClass();");
                this.emitBlock(["foreach (", ...args, " as $k => $v)"], () => {
                    this.phpFromObjConvert(
                        className,
                        mapType.values,
                        ["$out->$k = "],
                        ["$v"],
                    );
                });
                this.emitLine("return $out;");
            },
            (enumType) =>
                this.emitLine(
                    ...lhs,
                    this.nameForNamedType(enumType),
                    "::from(",
                    ...args,
                    "); ",
                    "/*enum*/",
                ),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitLine("if (!is_null(", ...args, ")) {");
                    this.indent(() =>
                        this.phpFromObjConvert(className, nullable, lhs, args),
                    );
                    this.emitLine("} else {");
                    this.indent(() => this.emitLine(...lhs, " null;"));
                    this.emitLine("}");
                    return;
                }

                this.emitUnionDispatch(
                    unionType,
                    args,
                    true,
                    (member) =>
                        this.phpFromObjConvert(className, member, lhs, args),
                    () =>
                        this.emitLine(
                            "throw new Exception('Cannot deserialize union value in ",
                            className,
                            "');",
                        ),
                );
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    this.emitLine(
                        "$tmp = ",
                        "DateTime::createFromFormat(DateTimeInterface::ISO8601, ",
                        args,
                        ");",
                    );
                    this.transformDateTime(className, "", ["$tmp"]);
                    this.emitLine("return $tmp;");
                    return;
                }

                if (transformedStringType.kind === "uuid") {
                    this.emitLine(...lhs, ...args, "; /*uuid*/");
                    return;
                }

                throw new Error('transformedStringType.kind === "unknown"');
            },
        );
    }

    protected phpSampleConvert(
        className: Name,
        t: Type,
        lhs: Sourcelike[],
        args: Sourcelike[],
        idx: number,
        suffix: Sourcelike,
    ): void {
        matchType(
            t,
            (_anyType) =>
                this.emitLine(
                    ...lhs,
                    "'AnyType::",
                    className,
                    "::",
                    args,
                    `::${idx}`,
                    "'",
                    suffix,
                    "/*",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                ),
            (_nullType) =>
                this.emitLine(
                    ...lhs,
                    "null",
                    suffix,
                    " /*",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                ),
            (_boolType) =>
                this.emitLine(
                    ...lhs,
                    "true",
                    suffix,
                    " /*",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                ),
            (_integerType) =>
                this.emitLine(
                    ...lhs,
                    `${idx}`,
                    suffix,
                    " /*",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                ),
            (_doubleType) =>
                this.emitLine(
                    ...lhs,
                    `${idx + idx / 1000}`,
                    suffix,
                    " /*",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                ),
            (_stringType) =>
                this.emitLine(
                    ...lhs,
                    "'",
                    className,
                    "::",
                    args,
                    `::${idx}`,
                    "'",
                    suffix,
                    " /*",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                ),
            (arrayType) => {
                this.emitLine(...lhs, " array(");
                this.indent(() => {
                    this.phpSampleConvert(
                        className,
                        arrayType.items,
                        [],
                        [],
                        idx,
                        "",
                    );
                });
                this.emitLine(")", suffix, " /* ", `${idx}`, ":", args, "*/");
            },
            (classType) =>
                this.emitLine(
                    ...lhs,
                    this.nameForNamedType(classType),
                    "::sample()",
                    suffix,
                    " /*",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                ),
            (mapType) => {
                // An immediately-invoked closure, so the sample is an
                // expression and can nest inside arrays and other maps.
                this.emitLine(...lhs, " (function () {");
                this.indent(() => {
                    this.emitLine("$out = new stdClass();");
                    this.phpSampleConvert(
                        className,
                        mapType.values,
                        ["$out->{'", className, "'} = "],
                        args,
                        idx,
                        ";",
                    );
                    this.emitLine("return $out;");
                });
                this.emitLine(
                    "})()",
                    suffix,
                    " /* ",
                    `${idx}`,
                    ":",
                    args,
                    "*/",
                );
            },
            (enumType) =>
                this.emitLine(
                    ...lhs,
                    this.nameForNamedType(enumType),
                    "::sample()",
                    suffix,
                    " /*enum*/",
                ),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.phpSampleConvert(
                        className,
                        nullable,
                        lhs,
                        args,
                        idx,
                        suffix,
                    );
                    return;
                }

                // Any member's sample is a valid sample for the union.
                const { members } = this.sortedUnionMembers(unionType);
                this.phpSampleConvert(
                    className,
                    defined(members[0]),
                    lhs,
                    args,
                    idx,
                    suffix,
                );
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    const x = _.pad(`${1 + (idx % 31)}`, 2, "0");
                    this.emitLine(
                        ...lhs,
                        "DateTime::createFromFormat(DateTimeInterface::ISO8601, '",
                        `2020-12-${x}T12:${x}:${x}+00:00`,
                        "')",
                        suffix,
                    );
                    // this.emitLine("return sample();");
                    return;
                }

                if (transformedStringType.kind === "uuid") {
                    this.emitLine(
                        ...lhs,
                        "'9277b8fb-2a65-4663-a36c-8d417e2d284b'",
                        suffix,
                        " /*",
                        `${idx}`,
                        ":",
                        args,
                        "*/",
                    );
                    return;
                }

                throw new Error('transformedStringType.kind === "unknown"');
            },
        );
    }

    private phpValidate(
        className: Name,
        t: Type,
        attrName: Sourcelike,
        scopeAttrName: string,
        skipPrimitiveTypeCheck = false,
    ): void {
        const is = (isfn: string, myT: Name = className): void => {
            this.emitBlock(["if (!", isfn, "(", scopeAttrName, "))"], () =>
                this.emitLine(
                    'throw new Exception("Attribute Error:',
                    myT,
                    "::",
                    attrName,
                    '");',
                ),
            );
        };

        matchType(
            t,
            (_anyType) => {
                // Every value is a valid `any`; there is nothing to check.
                // (This used to call `defined()`, which tests whether a
                // *constant* of the given name exists and throws for
                // non-string arguments.)
            },
            (_nullType) => is("is_null"),
            (_boolType) => {
                if (!skipPrimitiveTypeCheck) is("is_bool");
            },
            (_integerType) => {
                if (!skipPrimitiveTypeCheck) is("is_integer");
            },
            (_doubleType) => {
                if (!skipPrimitiveTypeCheck) {
                    // PHP integers are acceptable wherever floats are, and
                    // json_decode gives an int for a whole JSON number.
                    this.emitBlock(
                        [
                            "if (!is_float(",
                            scopeAttrName,
                            ") && !is_int(",
                            scopeAttrName,
                            "))",
                        ],
                        () =>
                            this.emitLine(
                                'throw new Exception("Attribute Error:',
                                className,
                                "::",
                                attrName,
                                '");',
                            ),
                    );
                }
            },
            (_stringType) => {
                if (!skipPrimitiveTypeCheck) is("is_string");
            },
            (arrayType) => {
                is("is_array");
                this.emitLine(
                    "array_walk(",
                    scopeAttrName,
                    ", function(",
                    scopeAttrName,
                    "_v) {",
                );
                this.indent(() => {
                    this.phpValidate(
                        className,
                        arrayType.items,
                        attrName,
                        `${scopeAttrName}_v`,
                    );
                });
                this.emitLine("});");
            },
            (_classType) => {
                this.emitLine(scopeAttrName, "->validate();");
            },
            (mapType) => {
                this.emitLine("foreach (", scopeAttrName, " as $k => $v) {");
                this.indent(() => {
                    this.phpValidate(className, mapType.values, attrName, "$v");
                });
                this.emitLine("}");
            },
            (enumType) => {
                this.emitLine(
                    this.phpType(false, enumType),
                    "::to(",
                    scopeAttrName,
                    ");",
                );
            },
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitBlock(
                        ["if (!is_null(", scopeAttrName, "))"],
                        () => {
                            this.phpValidate(
                                className,
                                nullable,
                                attrName,
                                scopeAttrName,
                                skipPrimitiveTypeCheck,
                            );
                        },
                    );
                    return;
                }

                this.emitUnionDispatch(
                    unionType,
                    [scopeAttrName],
                    false,
                    (member) =>
                        this.phpValidate(
                            className,
                            member,
                            attrName,
                            scopeAttrName,
                        ),
                    () =>
                        this.emitLine(
                            'throw new Exception("Attribute Error:',
                            className,
                            "::",
                            attrName,
                            '");',
                        ),
                );
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    this.transformDateTime(className, attrName, [
                        scopeAttrName,
                    ]);
                    return;
                }

                if (transformedStringType.kind === "uuid") {
                    if (!skipPrimitiveTypeCheck) is("is_string");
                    this.emitBlock(
                        [
                            "if (!preg_match('/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/', ",
                            scopeAttrName,
                            "))",
                        ],
                        () =>
                            this.emitLine(
                                'throw new Exception("Attribute Error:',
                                className,
                                "::",
                                attrName,
                                '");',
                            ),
                    );
                    return;
                }

                throw new Error(
                    `transformedStringType.kind === ${transformedStringType.kind}`,
                );
            },
        );
    }

    protected emitFromMethod(
        names: FunctionNames,
        p: ClassProperty,
        className: Name,
        _name: Name,
        desc?: string[],
    ): void {
        this.emitDocBlockDescription(desc);

        // this.emitLine(" * @param ", this.phpType(false, p.type, false, "", "|null"));
        this.emitLine(
            " * @param ",
            this.phpConvertType(className, p.type),
            " $value",
        );
        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpType(false, p.type));
        this.emitLine(" */");
        this.emitBlock(
            [
                "public static function ",
                names.from,
                "(",
                this.phpConvertType(className, p.type),
                " $value): ",
                this.phpType(false, p.type),
            ],
            () => {
                this.phpFromObjConvert(
                    className,
                    p.type,
                    ["return "],
                    ["$value"],
                );
                // this.emitLine("return $ret;");
            },
        );
    }

    protected emitToMethod(
        names: FunctionNames,
        p: ClassProperty,
        className: Name,
        name: Name,
        desc?: string[],
    ): void {
        this.emitDocBlockDescription(desc);

        this.emitLine(" * @throws Exception");
        this.emitLine(" * @return ", this.phpConvertType(className, p.type));
        this.emitLine(" */");
        this.emitBlock(
            [
                "public function ",
                names.to,
                "(): ",
                this.phpConvertType(className, p.type),
            ],
            () => {
                this.emitBlock(
                    [
                        "if (",
                        className,
                        "::",
                        names.validate,
                        "($this->",
                        name,
                        ")) ",
                    ],
                    () => {
                        this.phpToObjConvert(
                            className,
                            p.type,
                            ["return "],
                            ["$this->", name],
                        );
                    },
                );
                this.emitLine(
                    "throw new Exception('never get to this ",
                    className,
                    "::",
                    name,
                    "');",
                );
            },
        );
    }

    protected emitValidateMethod(
        names: FunctionNames,
        p: ClassProperty,
        className: Name,
        name: Name,
        desc?: string[],
    ): void {
        this.emitDocBlockDescription(desc);

        this.emitLine(
            " * @param ",
            this.phpType(false, p.type, false, "", "|null"),
        );
        this.emitLine(" * @return bool");
        this.emitLine(" * @throws Exception");
        this.emitLine(" */");
        this.emitBlock(
            [
                "public static function ",
                names.validate,
                "(",
                this.phpType(false, p.type),
                " $value): bool",
            ],
            () => {
                // PHP has already enforced scalar parameter type hints before
                // entering this method.  Recursive collection and union
                // validation still performs its own runtime checks.
                this.phpValidate(className, p.type, name, "$value", true);
                this.emitLine("return true;");
            },
        );
    }

    protected emitGetMethod(
        names: FunctionNames,
        p: ClassProperty,
        className: Name,
        name: Name,
        desc?: string[],
    ): void {
        if (this._options.withGet) {
            this.emitDocBlockDescription(desc);

            if (!this._options.fastGet) {
                this.emitLine(" * @throws Exception");
            }

            const rendered = this.phpType(false, p.type);
            this.emitLine(" * @return ", rendered);
            this.emitLine(" */");
            this.emitBlock(
                ["public function ", names.getter, "(): ", rendered],
                () => {
                    if (!this._options.fastGet) {
                        this.emitBlock(
                            [
                                "if (",
                                className,
                                "::",
                                names.validate,
                                "($this->",
                                name,
                                ")) ",
                            ],
                            () => {
                                this.emitLine("return $this->", name, ";");
                            },
                        );
                        this.emitLine(
                            "throw new Exception('never get to ",
                            names.getter,
                            " ",
                            className,
                            "::",
                            name,
                            "');",
                        );
                    } else {
                        this.emitLine("return $this->", name, ";");
                    }
                },
            );
        }
    }

    protected emitSetMethod(
        names: FunctionNames,
        p: ClassProperty,
        className: Name,
        name: Name,
        desc?: string[],
    ): void {
        if (this._options.withSet) {
            this.emitDocBlockDescription(desc);

            this.emitLine(
                " * @param ",
                this.phpType(false, p.type, false, "", "|null"),
            );
            this.emitLine(" * @throws Exception");
            this.emitLine(" */");
            this.emitBlock(
                [
                    "public function ",
                    names.setter,
                    "(",
                    this.phpType(false, p.type),
                    " $value)",
                ],
                () => {
                    this.emitBlock(
                        ["if (", className, "::", names.validate, "($value)) "],
                        () => {
                            this.emitLine("$this->", name, " = $value;");
                        },
                    );
                },
            );
        }
    }

    protected emitSampleMethod(
        names: FunctionNames,
        p: ClassProperty,
        className: Name,
        name: Name,
        desc: string[] | undefined,
        idx: number,
    ): void {
        if (this._options.withGet) {
            this.emitDocBlockDescription(desc);

            const rendered = this.phpType(false, p.type);
            this.emitLine(" * @return ", rendered);
            this.emitLine(" */");
            this.emitBlock(
                ["public static function ", names.sample, "(): ", rendered],
                () => {
                    this.phpSampleConvert(
                        className,
                        p.type,
                        ["return "],
                        [name],
                        idx,
                        ";",
                    );
                },
            );
        }
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitFileHeader(className, []);

        this.emitBlock(["class ", className], () => {
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                this.emitLine(
                    "private ",
                    this.phpType(false, p.type),
                    " $",
                    name,
                    "; // json:",
                    jsonName,
                    " ",
                    p.type.isNullable ? "Optional" : "Required",
                );
            });

            this.ensureBlankLine();
            const comments: Sourcelike[][] = [];
            const args: Sourcelike[][] = [];
            let prefix = "";
            this.forEachClassProperty(c, "none", (name, __, p) => {
                args.push([prefix, this.phpType(false, p.type), " $", name]);
                prefix = ", ";
                comments.push([
                    " * @param ",
                    this.phpType(false, p.type, false, "", "|null"),
                    " $",
                    name,
                    "\n",
                ]);
            });
            this.emitBlock(
                [
                    "/**\n",
                    ...comments,
                    " */\n",
                    "public function __construct(",
                    ...args,
                    ")",
                ],
                () => {
                    this.forEachClassProperty(c, "none", (name) => {
                        this.emitLine("$this->", name, " = $", name, ";");
                    });
                },
            );

            let idx = 31;
            this.forEachClassProperty(
                c,
                "leading-and-interposing",
                (name, jsonName, p) => {
                    const desc = this.descriptionForClassProperty(c, jsonName);
                    const names = defined(
                        this._gettersAndSettersForPropertyName.get(name),
                    );

                    this.ensureBlankLine();
                    this.emitFromMethod(names, p, className, name, desc);
                    this.ensureBlankLine();
                    this.emitToMethod(names, p, className, name, desc);
                    this.ensureBlankLine();
                    this.emitValidateMethod(names, p, className, name, desc);
                    this.ensureBlankLine();
                    this.emitGetMethod(names, p, className, name, desc);
                    this.ensureBlankLine();
                    this.emitSetMethod(names, p, className, name, desc);
                    this.ensureBlankLine();
                    this.emitSampleMethod(
                        names,
                        p,
                        className,
                        name,
                        desc,
                        idx++,
                    );
                },
            );

            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    " * @throws Exception\n",
                    " * @return bool\n",
                    " */\n",
                    "public function validate(): bool",
                ],
                () => {
                    const lines: Sourcelike[][] = [];
                    let p = "return ";
                    this.forEachClassProperty(
                        c,
                        "none",
                        (name, _jsonName, _p) => {
                            const names = defined(
                                this._gettersAndSettersForPropertyName.get(
                                    name,
                                ),
                            );
                            lines.push([
                                p,
                                className,
                                "::",
                                names.validate,
                                "($this->",
                                name,
                                ")",
                            ]);
                            p = "|| ";
                        },
                    );
                    if (lines.length === 0) {
                        // A class without properties has nothing to check.
                        this.emitLine("return true;");
                        return;
                    }

                    lines.forEach((line, jdx) => {
                        this.emitLine(
                            ...line,
                            lines.length === jdx + 1 ? ";" : "",
                        );
                    });
                },
            );

            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    " * @return stdClass\n",
                    " * @throws Exception\n",
                    " */\n",
                    "public function to(): stdClass ",
                ],
                () => {
                    this.emitLine("$out = new stdClass();");
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        const names = defined(
                            this._gettersAndSettersForPropertyName.get(name),
                        );
                        this.emitLine(
                            "$out->{'",
                            jsonName,
                            "'} = $this->",
                            names.to,
                            "();",
                        );
                    });
                    this.emitLine("return $out;");
                },
            );

            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    " * @param stdClass $obj\n",
                    " * @return ",
                    className,
                    "\n",
                    " * @throws Exception\n",
                    " */\n",
                    "public static function from(stdClass $obj): ",
                    className,
                ],
                () => {
                    if (this._options.fastGet) {
                        this.forEachClassProperty(c, "none", (name) => {
                            const names = defined(
                                this._gettersAndSettersForPropertyName.get(
                                    name,
                                ),
                            );
                            this.emitLine(
                                className,
                                "::",
                                names.validate,
                                "($this->",
                                name,
                                ", true);",
                            );
                        });
                    }

                    this.emitLine("return new ", className, "(");
                    let comma = " ";
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        const names = defined(
                            this._gettersAndSettersForPropertyName.get(name),
                        );
                        this.emitLine(
                            comma,
                            className,
                            "::",
                            names.from,
                            "($obj->{'",
                            jsonName,
                            "'})",
                        );
                        comma = ",";
                    });
                    this.emitLine(");");
                },
            );
            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    " * @return ",
                    className,
                    "\n",
                    " */\n",
                    "public static function sample(): ",
                    className,
                ],
                () => {
                    this.emitLine("return new ", className, "(");
                    let comma = " ";
                    this.forEachClassProperty(c, "none", (name) => {
                        const names = defined(
                            this._gettersAndSettersForPropertyName.get(name),
                        );
                        this.emitLine(
                            comma,
                            className,
                            "::",
                            names.sample,
                            "()",
                        );
                        comma = ",";
                    });
                    this.emitLine(");");
                },
            );
        });
        this.finishFile();
    }

    protected emitUnionAttributes(_u: UnionType, _unionName: Name): void {
        // empty
    }

    protected emitUnionSerializer(_u: UnionType, _unionName: Name): void {
        // empty
    }

    protected emitUnionDefinition(_u: UnionType, _unionName: Name): void {
        throw new Error("emitUnionDefinition not implemented");
    }

    protected emitEnumSerializationAttributes(_e: EnumType): void {
        // Empty
    }

    protected emitEnumDeserializationAttributes(_e: EnumType): void {
        // Empty
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitFileHeader(enumName, []);
        this.emitDescription(this.descriptionForType(e));
        const caseNames: Sourcelike[] = [];
        caseNames.push(";");
        const enumSerdeType = "string";
        this.emitBlock(["class ", enumName], () => {
            this.forEachEnumCase(e, "none", (name, _jsonName) => {
                this.emitLine("public static ", enumName, " $", name, ";");
            });

            this.emitBlock("public static function init()", () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine(
                        enumName,
                        "::$",
                        name,
                        " = new ",
                        enumName,
                        "('",
                        jsonName,
                        "');",
                    );
                });
            });

            this.emitLine("private ", enumSerdeType, " $enum;");
            this.emitBlock(
                ["public function __construct(", enumSerdeType, " $enum)"],
                () => {
                    this.emitLine("$this->enum = $enum;");
                },
            );

            this.ensureBlankLine();
            this.emitEnumSerializationAttributes(e);

            this.emitBlock(
                [
                    "/**\n",
                    " * @param ",
                    enumName,
                    "\n",
                    " * @return ",
                    enumSerdeType,
                    "\n",
                    " * @throws Exception\n",
                    " */\n",
                    "public static function to(",
                    enumName,
                    " $obj): ",
                    enumSerdeType,
                ],
                () => {
                    this.emitLine("switch ($obj->enum) {");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            // Todo String or Number
                            this.emitLine(
                                "case ",
                                enumName,
                                "::$",
                                name,
                                "->enum: return '",
                                stringEscape(jsonName),
                                "';",
                            );
                        });
                    });
                    this.emitLine("}");
                    this.emitLine(
                        "throw new Exception('the give value is not an enum-value.');",
                    );
                },
            );
            this.ensureBlankLine();
            this.emitEnumDeserializationAttributes(e);

            this.emitBlock(
                [
                    "/**\n",
                    " * @param mixed\n",
                    " * @return ",
                    enumName,
                    "\n",
                    " * @throws Exception\n",
                    " */\n",
                    "public static function from($obj): ",
                    enumName,
                ],
                () => {
                    this.emitLine("switch ($obj) {");
                    this.indent(() => {
                        this.forEachEnumCase(e, "none", (name, jsonName) => {
                            // Todo String or Enum
                            this.emitLine(
                                "case '",
                                stringEscape(jsonName),
                                "': return ",
                                enumName,
                                "::$",
                                name,
                                ";",
                            );
                        });
                    });
                    this.emitLine("}");
                    this.emitLine(
                        'throw new Exception("Cannot deserialize ',
                        enumName,
                        '");',
                    );
                },
            );
            this.ensureBlankLine();
            this.emitBlock(
                [
                    "/**\n",
                    " * @return ",
                    enumName,
                    "\n",
                    " */\n",
                    "public static function sample(): ",
                    enumName,
                ],
                () => {
                    const lines: Sourcelike[] = [];
                    this.forEachEnumCase(e, "none", (name) => {
                        lines.push([enumName, "::$", name]);
                    });
                    this.emitLine("return ", lines[0], ";");
                },
            );
        });
        this.emitLine(enumName, "::init();");
        this.finishFile();
    }

    protected emitSourceStructure(givenFilename: string): void {
        this.emitLine("<?php");
        this.emitLine("declare(strict_types=1);");
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitClassDefinition(c, n),
            (e, n) => this.emitEnumDefinition(e, n),
            (u, n) => this.emitUnionDefinition(u, n),
        );
        if (this._options.withClosing) {
            this.emitLine("?>");
        }

        super.finishFile(defined(givenFilename));
    }
}

"use strict";

import { Map } from "immutable";

import {
    TypeKind,
    Type,
    ClassType,
    EnumType,
    UnionType,
    nullableFromUnion,
    matchType,
    removeNullFromUnion
} from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import {
    legalizeCharacters,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    stringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";
import { defined } from "../Support";
import { StringOption, BooleanOption, Option } from "../RendererOptions";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { TargetLanguage } from "../TargetLanguage";
import { ConvenienceRenderer } from "../ConvenienceRenderer";

export default class GoTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);
    private readonly _packageOption = new StringOption("package", "Generated package name", "NAME", "main");

    constructor() {
        super("Go", ["go", "golang"], "go");
    }

    protected getOptions(): Option<any>[] {
        return [this._justTypesOption, this._packageOption];
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return GoRenderer;
    }

    protected get defaultIndentation(): string {
        return "\t";
    }
}

const namingFunction = funPrefixNamer("namer", goNameStyle);

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);

function goNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isLetterOrUnderscore
    );
}

const primitiveValueTypeKinds: TypeKind[] = ["integer", "double", "bool", "string"];
const compoundTypeKinds: TypeKind[] = ["array", "class", "map", "enum"];

function isValueType(t: Type): boolean {
    const kind = t.kind;
    return primitiveValueTypeKinds.indexOf(kind) >= 0 || kind === "class" || kind === "enum";
}

function singleDescriptionComment(description: string[] | undefined): string {
    if (description === undefined) return "";
    return "// " + description.join("; ");
}

class GoRenderer extends ConvenienceRenderer {
    private _topLevelUnmarshalNames = Map<Name, Name>();

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        private readonly _packageName: string
    ) {
        super(graph, leadingComments);
    }

    protected topLevelNameStyle(rawName: string): string {
        return goNameStyle(rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForClassProperty(): Namer {
        return namingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return namingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return namingFunction;
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return true;
    }

    protected makeTopLevelDependencyNames(_: Type, topLevelName: Name): DependencyName[] {
        const unmarshalName = new DependencyName(namingFunction, lookup => `unmarshal_${lookup(topLevelName)}`);
        this._topLevelUnmarshalNames = this._topLevelUnmarshalNames.set(topLevelName, unmarshalName);
        return [unmarshalName];
    }

    private emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    private emitFunc = (decl: Sourcelike, f: () => void): void => {
        this.emitBlock(["func ", decl], f);
    };

    private emitStruct = (name: Name, table: Sourcelike[][]): void => {
        this.emitBlock(["type ", name, " struct"], () => this.emitTable(table));
    };

    private nullableGoType = (t: Type, withIssues: boolean): Sourcelike => {
        const goType = this.goType(t, withIssues);
        if (isValueType(t)) {
            return ["*", goType];
        } else {
            return goType;
        }
    };

    private propertyGoType(t: Type): Sourcelike {
        const goType = this.goType(t, true);
        if (t instanceof UnionType && nullableFromUnion(t) === null) {
            return ["*", goType];
        }
        return goType;
    }

    private goType = (t: Type, withIssues: boolean = false): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "interface{}"),
            _nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "interface{}"),
            _boolType => "bool",
            _integerType => "int64",
            _doubleType => "float64",
            _stringType => "string",
            arrayType => ["[]", this.goType(arrayType.items, withIssues)],
            classType => this.nameForNamedType(classType),
            mapType => {
                let valueSource: Sourcelike;
                const v = mapType.values;
                if (v instanceof UnionType && nullableFromUnion(v) === null) {
                    valueSource = ["*", this.nameForNamedType(v)];
                } else {
                    valueSource = this.goType(v, withIssues);
                }
                return ["map[string]", valueSource];
            },
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return this.nullableGoType(nullable, withIssues);
                return this.nameForNamedType(unionType);
            }
        );
    };

    private emitTopLevel = (t: Type, name: Name): void => {
        const unmarshalName = defined(this._topLevelUnmarshalNames.get(name));
        if (this.namedTypeToNameForTopLevel(t) === undefined) {
            this.emitLine("type ", name, " ", this.goType(t));
        }

        if (this._justTypes) return;

        this.ensureBlankLine();
        this.emitFunc([unmarshalName, "(data []byte) (", name, ", error)"], () => {
            this.emitLine("var r ", name);
            this.emitLine("err := json.Unmarshal(data, &r)");
            this.emitLine("return r, err");
        });
        this.ensureBlankLine();
        this.emitFunc(["(r *", name, ") Marshal() ([]byte, error)"], () => {
            this.emitLine("return json.Marshal(r)");
        });
    };

    private emitClass = (c: ClassType, className: Name): void => {
        let columns: Sourcelike[][] = [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const goType = this.propertyGoType(p.type);
            const comment = singleDescriptionComment(this.descriptionForClassProperty(c, jsonName));
            columns.push([[name, " "], [goType, " "], ['`json:"', stringEscape(jsonName), '"`'], comment]);
        });
        this.emitDescription(this.descriptionForType(c));
        this.emitStruct(className, columns);
    };

    private emitEnum = (e: EnumType, enumName: Name): void => {
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("type ", enumName, " string");
        this.emitLine("const (");
        this.indent(() =>
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine(name, " ", enumName, ' = "', stringEscape(jsonName), '"');
            })
        );
        this.emitLine(")");
    };

    private emitUnion = (u: UnionType, unionName: Name): void => {
        const [hasNull, nonNulls] = removeNullFromUnion(u);
        const isNullableArg = hasNull !== null ? "true" : "false";

        const ifMember: <T, U>(
            kind: TypeKind,
            ifNotMember: U,
            f: (t: Type, fieldName: Name, goType: Sourcelike) => T
        ) => T | U = (kind, ifNotMember, f) => {
            const maybeType = u.findMember(kind);
            if (maybeType === undefined) return ifNotMember;
            return f(maybeType, this.nameForUnionMember(u, maybeType), this.goType(maybeType));
        };

        const maybeAssignNil = (kind: TypeKind): void => {
            ifMember(kind, undefined, (_1, fieldName, _2) => {
                this.emitLine("x.", fieldName, " = nil");
            });
        };
        const makeArgs = (
            primitiveArg: (fieldName: Sourcelike) => Sourcelike,
            compoundArg: (isClass: boolean, fieldName: Sourcelike) => Sourcelike
        ): Sourcelike => {
            const args: Sourcelike = [];
            for (const kind of primitiveValueTypeKinds) {
                args.push(ifMember(kind, "nil", (_1, fieldName, _2) => primitiveArg(fieldName)), ", ");
            }
            for (const kind of compoundTypeKinds) {
                args.push(
                    ifMember(kind, "false, nil", (t, fieldName, _) => compoundArg(t.kind === "class", fieldName)),
                    ", "
                );
            }
            args.push(isNullableArg);
            return args;
        };

        let columns: Sourcelike[][] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (fieldName, t) => {
            const goType = this.nullableGoType(t, true);
            columns.push([[fieldName, " "], goType]);
        });
        this.emitDescription(this.descriptionForType(u));
        this.emitStruct(unionName, columns);

        if (this._justTypes) return;

        this.ensureBlankLine();
        this.emitFunc(["(x *", unionName, ") UnmarshalJSON(data []byte) error"], () => {
            for (const kind of compoundTypeKinds) {
                maybeAssignNil(kind);
            }
            ifMember("class", undefined, (_1, _2, goType) => {
                this.emitLine("var c ", goType);
            });
            const args = makeArgs(
                fn => ["&x.", fn],
                (isClass, fn) => {
                    if (isClass) {
                        return "true, &c";
                    } else {
                        return ["true, &x.", fn];
                    }
                }
            );
            this.emitLine("object, err := unmarshalUnion(data, ", args, ")");
            this.emitBlock("if err != nil", () => {
                this.emitLine("return err");
            });
            this.emitBlock("if object", () => {
                ifMember("class", undefined, (_1, fieldName, _2) => {
                    this.emitLine("x.", fieldName, " = &c");
                });
            });
            this.emitLine("return nil");
        });
        this.ensureBlankLine();
        this.emitFunc(["(x *", unionName, ") MarshalJSON() ([]byte, error)"], () => {
            const args = makeArgs(fn => ["x.", fn], (_, fn) => ["x.", fn, " != nil, x.", fn]);
            this.emitLine("return marshalUnion(", args, ")");
        });
    };

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else if (!this._justTypes) {
            this.emitLine("// To parse and unparse this JSON data, add this code to your project and do:");
            this.forEachTopLevel("none", (_: Type, name: Name) => {
                this.emitLine("//");
                const ref = modifySource(camelCase, name);
                this.emitLine("//    ", ref, ", err := ", defined(this._topLevelUnmarshalNames.get(name)), "(bytes)");
                this.emitLine("//    bytes, err = ", ref, ".Marshal()");
            });
        }
        if (!this._justTypes) {
            this.ensureBlankLine();
            this.emitLine("package ", this._packageName);
            this.ensureBlankLine();
            if (this.haveNamedUnions) {
                this.emitLine('import "bytes"');
                this.emitLine('import "errors"');
            }
            this.emitLine('import "encoding/json"');
        }
        this.forEachTopLevel(
            "leading-and-interposing",
            this.emitTopLevel,
            t => !this._justTypes || this.namedTypeToNameForTopLevel(t) === undefined
        );
        this.forEachClass("leading-and-interposing", this.emitClass);
        this.forEachEnum("leading-and-interposing", this.emitEnum);
        this.forEachUnion("leading-and-interposing", this.emitUnion);

        if (this._justTypes) return;

        if (this.haveNamedUnions) {
            this.ensureBlankLine();
            this
                .emitMultiline(`func unmarshalUnion(data []byte, pi **int64, pf **float64, pb **bool, ps **string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, haveEnum bool, pe interface{}, nullable bool) (bool, error) {
    if pi != nil {
        *pi = nil
    }
    if pf != nil {
        *pf = nil
    }
    if pb != nil {
        *pb = nil
    }
    if ps != nil {
        *ps = nil
    }

    dec := json.NewDecoder(bytes.NewReader(data))
    dec.UseNumber()
    tok, err := dec.Token()
    if err != nil {
        return false, err
    }

    switch v := tok.(type) {
    case json.Number:
        if pi != nil {
            i, err := v.Int64()
            if err == nil {
                *pi = &i
                return false, nil
            }
        }
        if pf != nil {
            f, err := v.Float64()
            if err == nil {
                *pf = &f
                return false, nil
            }
            return false, errors.New("Unparsable number")
        }
        return false, errors.New("Union does not contain number")
    case float64:
        return false, errors.New("Decoder should not return float64")
    case bool:
        if pb != nil {
            *pb = &v
            return false, nil
        }
        return false, errors.New("Union does not contain bool")
    case string:
        if haveEnum {
            return false, json.Unmarshal(data, pe)
        }
        if ps != nil {
            *ps = &v
            return false, nil
        }
        return false, errors.New("Union does not contain string")
    case nil:
        if nullable {
            return false, nil
        }
        return false, errors.New("Union does not contain null")
    case json.Delim:
        if v == '{' {
            if haveObject {
                return true, json.Unmarshal(data, pc)
            }
            if haveMap {
                return false, json.Unmarshal(data, pm)
            }
            return false, errors.New("Union does not contain object")
        }
        if v == '[' {
            if haveArray {
                return false, json.Unmarshal(data, pa)
            }
            return false, errors.New("Union does not contain array")
        }
        return false, errors.New("Cannot handle delimiter")
    }
    return false, errors.New("Cannot unmarshal union")

}

func marshalUnion(pi *int64, pf *float64, pb *bool, ps *string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, haveEnum bool, pe interface{}, nullable bool) ([]byte, error) {
    if pi != nil {
        return json.Marshal(*pi)
    }
    if pf != nil {
        return json.Marshal(*pf)
    }
    if pb != nil {
        return json.Marshal(*pb)
    }
    if ps != nil {
        return json.Marshal(*ps)
    }
    if haveArray {
        return json.Marshal(pa)
    }
    if haveObject {
        return json.Marshal(pc)
    }
    if haveMap {
        return json.Marshal(pm)
    }
    if haveEnum {
        return json.Marshal(pe)
    }
    if nullable {
        return json.Marshal(nil)
    }
    return nil, errors.New("Union must not be null")
}`);
        }
    }
}

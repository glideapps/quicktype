"use strict";

import { Map } from "immutable";

import {
    TypeKind,
    Type,
    NamedType,
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
    allUpperWordStyle
} from "../Strings";
import { defined } from "../Support";
import { StringOption } from "../RendererOptions";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { TargetLanguage } from "../TargetLanguage";
import { ConvenienceRenderer } from "../ConvenienceRenderer";

export default class GoTargetLanguage extends TargetLanguage {
    private readonly _packageOption = new StringOption("package", "Generated package name", "NAME", "main");

    constructor() {
        super("Go", ["go", "golang"], "go");
        this.setOptions([this._packageOption]);
    }

    protected get rendererClass(): new (graph: TypeGraph, ...optionValues: any[]) => ConvenienceRenderer {
        return GoRenderer;
    }

    protected get indentation(): string {
        return "\t";
    }
}

const namingFunction = funPrefixNamer(goNameStyle);

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

class GoRenderer extends ConvenienceRenderer {
    private _topLevelUnmarshalNames = Map<Name, Name>();

    constructor(graph: TypeGraph, private readonly _packageName: string) {
        super(graph);
    }

    protected topLevelNameStyle(rawName: string): string {
        return goNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return namingFunction;
    }

    protected get classPropertyNamer(): Namer {
        return namingFunction;
    }

    protected get unionMemberNamer(): Namer {
        return namingFunction;
    }

    protected get enumCaseNamer(): Namer {
        return namingFunction;
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return true;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    protected topLevelDependencyNames(_: Type, topLevelName: Name): DependencyName[] {
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
            mapType => ["map[string]", this.goType(mapType.values, withIssues)],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable) return this.nullableGoType(nullable, withIssues);
                return this.nameForNamedType(unionType);
            }
        );
    };

    private emitTopLevel = (t: Type, name: Name): void => {
        const unmarshalName = defined(this._topLevelUnmarshalNames.get(name));
        if (!this.namedTypeToNameForTopLevel(t)) {
            this.emitLine("type ", name, " ", this.goType(t));
            this.emitNewline();
        }
        this.emitFunc([unmarshalName, "(data []byte) (", name, ", error)"], () => {
            this.emitLine("var r ", name);
            this.emitLine("err := json.Unmarshal(data, &r)");
            this.emitLine("return r, err");
        });
        this.emitNewline();
        this.emitFunc(["(r *", name, ") Marshal() ([]byte, error)"], () => {
            this.emitLine("return json.Marshal(r)");
        });
    };

    private emitClass = (c: ClassType, className: Name): void => {
        let columns: Sourcelike[][] = [];
        this.forEachClassProperty(c, "none", (name, jsonName, t) => {
            const goType = this.goType(t, true);
            columns.push([[name, " "], [goType, " "], ['`json:"', stringEscape(jsonName), '"`']]);
        });
        this.emitStruct(className, columns);
    };

    private emitEnum = (e: EnumType, enumName: Name): void => {
        this.emitLine("type ", enumName, " int");
        this.emitLine("const (");
        let onFirst = true;
        this.indent(() =>
            this.forEachEnumCase(e, "none", name => {
                if (onFirst) {
                    this.emitLine(name, " ", enumName, " = iota");
                } else {
                    this.emitLine(name);
                }
                onFirst = false;
            })
        );
        this.emitLine(")");
        this.emitNewline();
        this.emitFunc(["(x *", enumName, ") UnmarshalJSON(data []byte) error"], () => {
            this.emitMultiline(`dec := json.NewDecoder(bytes.NewReader(data))
tok, err := dec.Token()
if err != nil {
    return err
}`);
            this.emitBlock("if v, ok := tok.(string); ok", () => {
                this.emitBlock("switch v", () => {
                    this.forEachEnumCase(e, "none", (name, jsonName) => {
                        this.emitLine('case "', stringEscape(jsonName), '":');
                        this.indent(() => this.emitLine("*x = ", name));
                    });
                    this.emitLine("default:");
                    this.indent(() =>
                        this.emitLine(
                            'return errors.New(fmt.Sprintf("Unknown enum value \\"%s\\" for type ',
                            enumName,
                            '", v))'
                        )
                    );
                });
                this.emitLine("return nil");
            });
            this.emitLine('return errors.New("Value for enum must be string")');
        });
        this.emitNewline();
        this.emitFunc(["(x *", enumName, ") MarshalJSON() ([]byte, error)"], () => {
            this.emitBlock("switch *x", () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ":");
                    this.indent(() => this.emitLine('return json.Marshal("', stringEscape(jsonName), '")'));
                });
            });
            this.emitLine('panic("Invalid enum value")');
        });
    };

    private emitUnion = (u: UnionType, unionName: Name): void => {
        const [hasNull, nonNulls] = removeNullFromUnion(u);
        const isNullableArg = hasNull ? "true" : "false";

        const ifMember: <T, U>(
            kind: TypeKind,
            ifNotMember: U,
            f: (t: Type, fieldName: Name, goType: Sourcelike) => T
        ) => T | U = (kind, ifNotMember, f) => {
            const maybeType = u.findMember(kind);
            if (!maybeType) return ifNotMember;
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
        this.emitStruct(unionName, columns);
        this.emitNewline();
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
        this.emitNewline();
        this.emitFunc(["(x *", unionName, ") MarshalJSON() ([]byte, error)"], () => {
            const args = makeArgs(fn => ["x.", fn], (_, fn) => ["x.", fn, " != nil, x.", fn]);
            this.emitLine("return marshalUnion(", args, ")");
        });
    };

    protected emitSourceStructure(): void {
        this.emitLine("// To parse and unparse this JSON data, add this code to your project and do:");
        this.forEachTopLevel("none", (_: Type, name: Name) => {
            this.emitLine("//");
            this.emitLine("//    r, err := ", defined(this._topLevelUnmarshalNames.get(name)), "(bytes)");
            this.emitLine("//    bytes, err = r.Marshal()");
        });
        this.emitNewline();
        this.emitLine("package ", this._packageName);
        this.emitNewline();
        if (this.haveEnums || this.haveNamedUnions) {
            this.emitLine('import "bytes"');
            this.emitLine('import "errors"');
        }
        if (this.haveEnums) {
            this.emitLine('import "fmt"');
        }
        this.emitLine('import "encoding/json"');
        this.forEachTopLevel("leading-and-interposing", this.emitTopLevel);
        this.forEachClass("leading-and-interposing", this.emitClass);
        this.forEachEnum("leading-and-interposing", this.emitEnum);
        this.forEachUnion("leading-and-interposing", this.emitUnion);
        if (this.haveNamedUnions) {
            this.emitNewline();
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

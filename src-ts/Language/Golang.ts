"use strict";

import { Set, OrderedSet, List, Map, OrderedMap } from "immutable";

import { TypeKind } from "Reykjavik";
import {
    Type,
    TopLevels,
    PrimitiveType,
    NamedType,
    ClassType,
    UnionType,
    nullableFromUnion,
    matchType,
    removeNullFromUnion
} from "../Type";
import { Namespace, Name, DependencyName, Namer, funPrefixNamer } from "../Naming";
import {
    legalizeCharacters,
    camelCase,
    startWithLetter,
    isLetterOrUnderscore,
    isLetterOrUnderscoreOrDigit,
    stringEscape,
    defined
} from "../Support";
import { StringOption } from "../RendererOptions";
import { Sourcelike, maybeAnnotated } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { TypeScriptTargetLanguage } from "../TargetLanguage";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";

export default class GoTargetLanguage extends TypeScriptTargetLanguage {
    private readonly _packageOption: StringOption;

    constructor() {
        const packageOption = new StringOption("package", "Generated package name", "NAME", "main");
        super("Go", ["go", "golang"], "go", [packageOption.definition]);
        this._packageOption = packageOption;
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new GoRenderer(topLevels, this._packageOption.getValue(optionValues));
        return renderer.render();
    }

    protected get indentation(): string {
        return "\t";
    }
}

const namingFunction = funPrefixNamer(goNameStyle);

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);

function goNameStyle(original: string): string {
    const legalized = legalizeName(original);
    const cameled = camelCase(legalized);
    return startWithLetter(isLetterOrUnderscore, true, cameled);
}

const primitiveValueTypeKinds: TypeKind[] = ["integer", "double", "bool", "string"];
const compoundTypeKinds: TypeKind[] = ["array", "class", "map"];

function isValueType(t: Type): boolean {
    const kind = t.kind;
    return primitiveValueTypeKinds.indexOf(kind) >= 0 || kind === "class";
}

class GoRenderer extends ConvenienceRenderer {
    private _topLevelUnmarshalNames = Map<Name, Name>();

    constructor(topLevels: TopLevels, private readonly _packageName: string) {
        super(topLevels);
    }

    protected topLevelNameStyle(rawName: string): string {
        return goNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return namingFunction;
    }

    protected get propertyNamer(): Namer {
        return namingFunction;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    protected topLevelDependencyNames(topLevelName: Name): DependencyName[] {
        const unmarshalName = new DependencyName(
            namingFunction,
            List([topLevelName]),
            (names: List<string>) => `Unmarshal${names.first()}`
        );
        this._topLevelUnmarshalNames = this._topLevelUnmarshalNames.set(
            topLevelName,
            unmarshalName
        );
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
            anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, "interface{}"),
            nullType => maybeAnnotated(withIssues, nullTypeIssueAnnotation, "interface{}"),
            boolType => "bool",
            integerType => "int64",
            doubleType => "float64",
            stringType => "string",
            arrayType => ["[]", this.goType(arrayType.items, withIssues)],
            classType => this.nameForNamedType(classType),
            mapType => ["map[string]", this.goType(mapType.values, withIssues)],
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

    private emitClass = (
        c: ClassType,
        className: Name,
        propertyNames: OrderedMap<string, Name>
    ): void => {
        let columns: Sourcelike[][] = [];
        propertyNames.forEach((name: Name, jsonName: string) => {
            const goType = this.goType(defined(c.properties.get(jsonName)), true);
            columns.push([[name, " "], [goType, " "], ['`json:"', stringEscape(jsonName), '"`']]);
        });
        this.emitStruct(className, columns);
    };

    private emitUnion = (c: UnionType, unionName: Name): void => {
        const [hasNull, nonNulls] = removeNullFromUnion(c);
        const isNullableArg = hasNull ? "true" : "false";

        const ifMember: <T, U>(
            kind: TypeKind,
            ifNotMember: U,
            f: (t: Type, fieldName: string, goType: Sourcelike) => T
        ) => T | U = (kind, ifNotMember, f) => {
            const maybeType = c.members.find((t: Type) => t.kind === kind);
            if (!maybeType) return ifNotMember;
            return f(maybeType, this.unionFieldName(maybeType), this.goType(maybeType));
        };

        const maybeAssignNil = (kind: TypeKind): void => {
            ifMember(kind, undefined, (_1, fieldName, _2) => {
                this.emitLine("x.", fieldName, " = nil");
            });
        };
        const makeArgs = (
            primitiveArg: (fieldName: string) => Sourcelike,
            compoundArg: (isClass: boolean, fieldName: string) => Sourcelike
        ): Sourcelike => {
            const args: Sourcelike = [];
            for (const kind of primitiveValueTypeKinds) {
                args.push(
                    ifMember(kind, "nil", (_1, fieldName, _2) => primitiveArg(fieldName)),
                    ", "
                );
            }
            for (const kind of compoundTypeKinds) {
                args.push(
                    ifMember(kind, "false, nil", (t, fieldName, _) =>
                        compoundArg(t.kind === "class", fieldName)
                    ),
                    ", "
                );
            }
            args.push(isNullableArg);
            return args;
        };

        let columns: Sourcelike[][] = [];
        nonNulls.forEach((t: Type) => {
            const fieldName = this.unionFieldName(t);
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
        this.emitLine(
            "// To parse and unparse this JSON data, add this code to your project and do:"
        );
        this.forEachTopLevel("none", (t: Type, name: Name) => {
            this.emitLine("//");
            this.emitLine(
                "//    r, err := ",
                defined(this._topLevelUnmarshalNames.get(name)),
                "(bytes)"
            );
            this.emitLine("//    bytes, err = r.Marshal()");
        });
        this.emitNewline();
        this.emitLine("package ", this._packageName);
        this.emitNewline();
        if (this.haveUnions) {
            this.emitLine('import "bytes"');
            this.emitLine('import "errors"');
        }
        this.emitLine('import "encoding/json"');
        this.forEachTopLevel("leading-and-interposing", this.emitTopLevel);
        this.forEachClass("leading-and-interposing", this.emitClass);
        this.forEachUnion("leading-and-interposing", this.emitUnion);
        if (this.haveUnions) {
            this.emitNewline();
            this
                .emitMultiline(`func unmarshalUnion(data []byte, pi **int64, pf **float64, pb **bool, ps **string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, nullable bool) (bool, error) {
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

func marshalUnion(pi *int64, pf *float64, pb *bool, ps *string, haveArray bool, pa interface{}, haveObject bool, pc interface{}, haveMap bool, pm interface{}, nullable bool) ([]byte, error) {
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
    if nullable {
        return json.Marshal(nil)
    }
    return nil, errors.New("Union must not be null")
}
`);
        }
    }
}

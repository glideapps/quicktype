import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../../Annotation";
import { ConvenienceRenderer } from "../../ConvenienceRenderer";
import { DependencyName, type Name, type Namer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, maybeAnnotated, modifySource } from "../../Source";
import { camelCase, stringEscape } from "../../support/Strings";
import { assert, defined } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import { type ClassProperty, type ClassType, type EnumType, type Type, type TypeKind, UnionType } from "../../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../../TypeUtils";

import { type goOptions } from "./language";
import { canOmitEmpty, compoundTypeKinds, isValueType, namingFunction, primitiveValueTypeKinds } from "./utils";

export class GoRenderer extends ConvenienceRenderer {
    private readonly _topLevelUnmarshalNames = new Map<Name, Name>();

    private _currentFilename: string | undefined;

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof goOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForObjectProperty(): Namer {
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
        const unmarshalName = new DependencyName(
            namingFunction,
            topLevelName.order,
            lookup => `unmarshal_${lookup(topLevelName)}`
        );
        this._topLevelUnmarshalNames.set(topLevelName, unmarshalName);
        return [unmarshalName];
    }

    /// startFile takes a file name, lowercases it, appends ".go" to it, and sets it as the current filename.
    protected startFile(basename: Sourcelike): void {
        if (this._options.multiFileOutput === false) {
            return;
        }

        assert(this._currentFilename === undefined, "Previous file wasn't finished: " + this._currentFilename);
        this._currentFilename = `${this.sourcelikeToString(basename)}.go`;
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

    private emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    private emitFunc(decl: Sourcelike, f: () => void): void {
        this.emitBlock(["func ", decl], f);
    }

    private emitStruct(name: Name, table: Sourcelike[][]): void {
        this.emitBlock(["type ", name, " struct"], () => this.emitTable(table));
    }

    private nullableGoType(t: Type, withIssues: boolean): Sourcelike {
        const goType = this.goType(t, withIssues);
        if (isValueType(t)) {
            return ["*", goType];
        } else {
            return goType;
        }
    }

    private propertyGoType(cp: ClassProperty): Sourcelike {
        const t = cp.type;
        if (t instanceof UnionType && nullableFromUnion(t) === null) {
            return ["*", this.goType(t, true)];
        }

        if (cp.isOptional) {
            return this.nullableGoType(t, true);
        }

        return this.goType(t, true);
    }

    private goType(t: Type, withIssues = false): Sourcelike {
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
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return "time.Time";
                }

                return "string";
            }
        );
    }

    private emitTopLevel(t: Type, name: Name): void {
        this.startFile(name);

        if (
            this._options.multiFileOutput &&
            this._options.justTypes === false &&
            this._options.justTypesAndPackage === false &&
            this.leadingComments === undefined
        ) {
            this.emitLineOnce(
                "// This file was generated from JSON Schema using quicktype, do not modify it directly."
            );
            this.emitLineOnce("// To parse and unparse this JSON data, add this code to your project and do:");
            this.emitLineOnce("//");
            const ref = modifySource(camelCase, name);
            this.emitLineOnce("//    ", ref, ", err := ", defined(this._topLevelUnmarshalNames.get(name)), "(bytes)");
            this.emitLineOnce("//    bytes, err = ", ref, ".Marshal()");
        }

        this.emitPackageDefinitons(true);

        const unmarshalName = defined(this._topLevelUnmarshalNames.get(name));
        if (this.namedTypeToNameForTopLevel(t) === undefined) {
            this.emitLine("type ", name, " ", this.goType(t));
        }

        if (this._options.justTypes || this._options.justTypesAndPackage) return;

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
        this.endFile();
    }

    private emitClass(c: ClassType, className: Name): void {
        this.startFile(className);
        let columns: Sourcelike[][] = [];
        const usedTypes = new Set<string>();
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const description = this.descriptionForClassProperty(c, jsonName);
            const docStrings =
                description !== undefined && description.length > 0 ? description.map(d => "// " + d) : [];
            const goType = this.propertyGoType(p);
            const omitEmpty = canOmitEmpty(p, this._options.omitEmpty) ? ",omitempty" : [];

            docStrings.forEach(doc => columns.push([doc]));
            const tags = this._options.fieldTags
                .split(",")
                .map(tag => tag + ':"' + stringEscape(jsonName) + omitEmpty + '"')
                .join(" ");
            columns.push([
                [name, " "],
                [goType, " "],
                ["`", tags, "`"]
            ]);
            usedTypes.add(goType.toString());
        });

        this.emitPackageDefinitons(
            false,
            usedTypes.has("time.Time") || usedTypes.has("*,time.Time") || usedTypes.has("[],time.Time")
                ? new Set<string>(["time"])
                : undefined
        );
        this.emitDescription(this.descriptionForType(c));
        this.emitStruct(className, columns);
        this.endFile();
    }

    private emitEnum(e: EnumType, enumName: Name): void {
        this.startFile(enumName);
        this.emitPackageDefinitons(false);
        this.emitDescription(this.descriptionForType(e));
        this.emitLine("type ", enumName, " string");
        this.ensureBlankLine();
        this.emitLine("const (");
        let columns: Sourcelike[][] = [];
        this.forEachEnumCase(e, "none", (name, jsonName) => {
            columns.push([
                this._options.enumTypeNameSuffix ? [name, enumName, " "] : [name, " "],
                [enumName, ' = "', stringEscape(jsonName), '"']
            ]);
        });
        this.indent(() => this.emitTable(columns));
        this.emitLine(")");
        this.endFile();
    }

    private emitUnion(u: UnionType, unionName: Name): void {
        this.startFile(unionName);
        this.emitPackageDefinitons(false);
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
                args.push(
                    ifMember(kind, "nil", (_1, fieldName, _2) => primitiveArg(fieldName)),
                    ", "
                );
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

        if (this._options.justTypes || this._options.justTypesAndPackage) return;

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
            const args = makeArgs(
                fn => ["x.", fn],
                (_, fn) => ["x.", fn, " != nil, x.", fn]
            );
            this.emitLine("return marshalUnion(", args, ")");
        });
        this.endFile();
    }

    private emitSingleFileHeaderComments(): void {
        this.emitLineOnce("// This file was generated from JSON Schema using quicktype, do not modify it directly.");
        this.emitLineOnce("// To parse and unparse this JSON data, add this code to your project and do:");
        this.forEachTopLevel("none", (_: Type, name: Name) => {
            this.emitLine("//");
            const ref = modifySource(camelCase, name);
            this.emitLine("//    ", ref, ", err := ", defined(this._topLevelUnmarshalNames.get(name)), "(bytes)");
            this.emitLine("//    bytes, err = ", ref, ".Marshal()");
        });
    }

    private emitPackageDefinitons(includeJSONEncodingImport: boolean, imports: Set<string> = new Set<string>()): void {
        if (!this._options.justTypes || this._options.justTypesAndPackage) {
            this.ensureBlankLine();
            const packageDeclaration = "package " + this._options.packageName;
            this.emitLineOnce(packageDeclaration);
            this.ensureBlankLine();
        }

        if (!this._options.justTypes && !this._options.justTypesAndPackage) {
            if (this.haveNamedUnions && this._options.multiFileOutput === false) {
                imports.add("bytes");
                imports.add("errors");
            }

            if (includeJSONEncodingImport) {
                imports.add("encoding/json");
            }
        }

        this.emitImports(imports);
    }

    private emitImports(imports: Set<string>): void {
        const sortedImports = Array.from(imports).sort((a, b) => a.localeCompare(b));

        if (sortedImports.length === 0) {
            return;
        }

        sortedImports.forEach(packageName => {
            this.emitLineOnce(`import "${packageName}"`);
        });
        this.ensureBlankLine();
    }

    private emitHelperFunctions(): void {
        if (this.haveNamedUnions) {
            this.startFile("JSONSchemaSupport");
            const imports = new Set<string>();
            if (this._options.multiFileOutput) {
                imports.add("bytes");
                imports.add("errors");
            }

            this.emitPackageDefinitons(true, imports);
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
            this.endFile();
        }
    }

    protected emitSourceStructure(): void {
        if (
            this._options.multiFileOutput === false &&
            this._options.justTypes === false &&
            this._options.justTypesAndPackage === false &&
            this.leadingComments === undefined
        ) {
            this.emitSingleFileHeaderComments();
            this.emitPackageDefinitons(false, this.collectAllImports());
        }

        this.forEachTopLevel(
            "leading-and-interposing",
            (t, name) => this.emitTopLevel(t, name),
            t =>
                !(this._options.justTypes || this._options.justTypesAndPackage) ||
                this.namedTypeToNameForTopLevel(t) === undefined
        );
        this.forEachObject("leading-and-interposing", (c: ClassType, className: Name) => this.emitClass(c, className));
        this.forEachEnum("leading-and-interposing", (u: EnumType, enumName: Name) => this.emitEnum(u, enumName));
        this.forEachUnion("leading-and-interposing", (u: UnionType, unionName: Name) => this.emitUnion(u, unionName));

        if (this._options.justTypes || this._options.justTypesAndPackage) {
            return;
        }

        this.emitHelperFunctions();
    }

    private collectAllImports(): Set<string> {
        let imports = new Set<string>();
        this.forEachObject("leading-and-interposing", (c: ClassType, _className: Name) => {
            const classImports = this.collectClassImports(c);
            imports = new Set([...imports, ...classImports]);
        });

        this.forEachUnion("leading-and-interposing", (u: UnionType, _unionName: Name) => {
            const unionImports = this.collectUnionImports(u);
            imports = new Set([...imports, ...unionImports]);
        });
        return imports;
    }

    private collectClassImports(c: ClassType): Set<string> {
        const usedTypes = new Set<string>();
        const mapping: Map<string, string> = new Map();
        mapping.set("time.Time", "time");
        mapping.set("*,time.Time", "time");
        mapping.set("[],time.Time", "time");

        this.forEachClassProperty(c, "none", (_name, _jsonName, p) => {
            const goType = this.propertyGoType(p);
            usedTypes.add(goType.toString());
        });

        const imports = new Set<string>();
        usedTypes.forEach(k => {
            const typeImport = mapping.get(k);
            if (typeImport) {
                imports.add(typeImport);
            }
        });

        return imports;
    }

    private collectUnionImports(u: UnionType): Set<string> {
        const usedTypes = new Set<string>();
        const mapping: Map<string, string> = new Map();
        mapping.set("time.Time", "time");
        mapping.set("*,time.Time", "time");

        this.forEachUnionMember(u, null, "none", null, (_fieldName, t) => {
            const goType = this.nullableGoType(t, true);
            usedTypes.add(goType.toString());
        });

        const imports = new Set<string>();
        usedTypes.forEach(k => {
            const typeImport = mapping.get(k);
            if (!typeImport) {
                return;
            }

            imports.add(typeImport);
        });

        return imports;
    }
}

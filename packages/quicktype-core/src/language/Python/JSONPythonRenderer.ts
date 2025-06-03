import { arrayIntercalate } from "collection-utils";

import { topLevelNameOrder } from "../../ConvenienceRenderer";
import { DependencyName, type Name, funPrefixNamer } from "../../Naming";
import {
    type MultiWord,
    type Sourcelike,
    multiWord,
    parenIfNeeded,
    singleWord,
} from "../../Source";
import { assertNever, defined, panic } from "../../support/Support";
import {
    ChoiceTransformer,
    DecodingChoiceTransformer,
    DecodingTransformer,
    EncodingTransformer,
    ParseStringTransformer,
    StringifyTransformer,
    type Transformer,
    UnionInstantiationTransformer,
    UnionMemberMatchTransformer,
    transformationForType,
} from "../../Transformers";
import type { ClassType, Type } from "../../Type";
import { matchType } from "../../Type/TypeUtils";

import { PythonRenderer } from "./PythonRenderer";
import { snakeNameStyle } from "./utils";

export type ConverterFunction =
    | "none"
    | "bool"
    | "int"
    | "from-float"
    | "to-float"
    | "str"
    | "to-enum"
    | "list"
    | "to-class"
    | "dict"
    | "union"
    | "from-datetime"
    | "from-stringified-bool"
    | "is-type";

interface TopLevelConverterNames {
    fromDict: Name;
    toDict: Name;
}

// A value or a lambda.  All four combinations are valid:
//
// * `value` and `lambda`: a value given by applying `value` to `lambda`, i.e. `lambda(value)`
// * `lambda` only: a lambda given by `lambda`
// * `value` only: a value given by `value`
// * neither: the identity function, i.e. `lambda x: x`
export interface ValueOrLambda {
    lambda?: MultiWord;
    value: Sourcelike | undefined;
}

// Return the result of composing `input` and `f`.  `input` can be a
// value or a lambda, but `f` must be a lambda or a TypeScript function
// (i.e. it can't be a value).
//
// * If `input` is a value, the result is `f(input)`.
// * If `input` is a lambda, the result is `lambda x: f(input(x))`
function compose(
    input: ValueOrLambda,
    f: (arg: Sourcelike) => Sourcelike,
): ValueOrLambda;
// FIXME: refactor this
// eslint-disable-next-line @typescript-eslint/unified-signatures
function compose(input: ValueOrLambda, f: ValueOrLambda): ValueOrLambda;
function compose(
    input: ValueOrLambda,
    f: ValueOrLambda | ((arg: Sourcelike) => Sourcelike),
): ValueOrLambda {
    if (typeof f === "function") {
        if (input.value !== undefined) {
            // `input` is a value, so just apply `f` to its source form.
            return { value: f(makeValue(input)) };
        }

        if (input.lambda !== undefined) {
            // `input` is a lambda, so build `lambda x: f(input(x))`.
            return {
                lambda: multiWord(
                    " ",
                    "lambda x:",
                    f([parenIfNeeded(input.lambda), "(x)"]),
                ),
                value: undefined,
            };
        }

        // `input` is the identify function, so the composition is `lambda x: f(x)`.
        return {
            lambda: multiWord(" ", "lambda x:", f("x")),
            value: undefined,
        };
    }

    if (f.value !== undefined) {
        return panic("Cannot compose into a value");
    }

    if (f.lambda === undefined) {
        // `f` is the identity function, so the result is just `input`.
        return input;
    }

    if (input.value === undefined) {
        // `input` is a lambda
        if (input.lambda === undefined) {
            // `input` is the identity function, so the result is just `f`.
            return f;
        }

        // `input` is a lambda, so the result is `lambda x: f(input(x))`.
        return {
            lambda: multiWord(
                "",
                "lambda x: ",
                parenIfNeeded(f.lambda),
                "(",
                parenIfNeeded(input.lambda),
                "(x))",
            ),
            value: undefined,
        };
    }

    // `input` is a value, so return `f(input)`.
    return { lambda: f.lambda, value: makeValue(input) };
}

const identity: ValueOrLambda = { value: undefined };

// If `vol` is a lambda, return it in its source form.  If it's
// a value, return a `lambda` that returns the value.
function makeLambda(vol: ValueOrLambda): MultiWord {
    if (vol.lambda !== undefined) {
        if (vol.value === undefined) {
            return vol.lambda;
        }

        return multiWord(
            "",
            "lambda x: ",
            parenIfNeeded(vol.lambda),
            "(",
            vol.value,
            ")",
        );
    }
    if (vol.value !== undefined) {
        return multiWord(" ", "lambda x:", vol.value);
    }

    return multiWord(" ", "lambda x:", "x");
}

// If `vol` is a value, return the value in its source form.
// Calling this with `vol` being a lambda is not allowed.
function makeValue(vol: ValueOrLambda): Sourcelike {
    if (vol.value === undefined) {
        return panic("Cannot make value from lambda without value");
    }

    if (vol.lambda !== undefined) {
        return [parenIfNeeded(vol.lambda), "(", vol.value, ")"];
    }

    return vol.value;
}

export class JSONPythonRenderer extends PythonRenderer {
    private readonly _deserializerFunctions = new Set<ConverterFunction>();

    private readonly _converterNamer = funPrefixNamer("converter", (s) =>
        snakeNameStyle(s, false, this.pyOptions.nicePropertyNames),
    );

    private readonly _topLevelConverterNames = new Map<
        Name,
        TopLevelConverterNames
    >();

    private _haveTypeVar = false;

    private _haveEnumTypeVar = false;

    private _haveDateutil = false;

    protected emitTypeVar(tvar: string, constraints: Sourcelike): void {
        if (!this.pyOptions.features.typeHints) {
            return;
        }

        this.emitLine(
            tvar,
            " = ",
            this.withTyping("TypeVar"),
            "(",
            this.string(tvar),
            constraints,
            ")",
        );
    }

    protected typeVar(): string {
        this._haveTypeVar = true;
        // FIXME: This is ugly, but the code that requires the type variables, in
        // `emitImports` actually runs after imports have been imported.  The proper
        // solution would be to either allow more complex dependencies, or to
        // gather-emit the type variable declarations, too.  Unfortunately the
        // gather-emit is a bit buggy with blank lines, and I can't be bothered to
        // fix it now.
        this.withTyping("TypeVar");
        return "T";
    }

    protected enumTypeVar(): string {
        this._haveEnumTypeVar = true;
        // See the comment above.
        this.withTyping("TypeVar");
        this.withImport("enum", "Enum");
        return "EnumT";
    }

    protected cast(type: Sourcelike, v: Sourcelike): Sourcelike {
        if (!this.pyOptions.features.typeHints) {
            return v;
        }

        return [this.withTyping("cast"), "(", type, ", ", v, ")"];
    }

    protected emitNoneConverter(): void {
        // FIXME: We can't return the None type here because mypy thinks that means
        // We're not returning any value, when we're actually returning `None`.
        this.emitBlock(
            [
                "def from_none(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", this.withTyping("Any")),
                ":",
            ],
            () => {
                this.emitLine("assert x is None");
                this.emitLine("return x");
            },
        );
    }

    protected emitBoolConverter(): void {
        this.emitBlock(
            [
                "def from_bool(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> bool"),
                ":",
            ],
            () => {
                this.emitLine("assert isinstance(x, bool)");
                this.emitLine("return x");
            },
        );
    }

    protected emitIntConverter(): void {
        this.emitBlock(
            [
                "def from_int(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> int"),
                ":",
            ],
            () => {
                this.emitLine(
                    "assert isinstance(x, int) and not isinstance(x, bool)",
                );
                this.emitLine("return x");
            },
        );
    }

    protected emitFromFloatConverter(): void {
        this.emitBlock(
            [
                "def from_float(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> float"),
                ":",
            ],
            () => {
                this.emitLine(
                    "assert isinstance(x, (float, int)) and not isinstance(x, bool)",
                );
                this.emitLine("return float(x)");
            },
        );
    }

    protected emitToFloatConverter(): void {
        this.emitBlock(
            [
                "def to_float(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> float"),
                ":",
            ],
            () => {
                this.emitLine("assert isinstance(x, (int, float))");
                this.emitLine("return x");
            },
        );
    }

    protected emitStrConverter(): void {
        this.emitBlock(
            [
                "def from_str(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> str"),
                ":",
            ],
            () => {
                const strType = "str";
                this.emitLine("assert isinstance(x, ", strType, ")");
                this.emitLine("return x");
            },
        );
    }

    protected emitToEnumConverter(): void {
        const tvar = this.enumTypeVar();
        this.emitBlock(
            [
                "def to_enum(c",
                this.typeHint(": ", this.withTyping("Type"), "[", tvar, "]"),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", tvar),
                ":",
            ],
            () => {
                this.emitLine("assert isinstance(x, c)");
                this.emitLine("return x.value");
            },
        );
    }

    protected emitListConverter(): void {
        const tvar = this.typeVar();
        this.emitBlock(
            [
                "def from_list(f",
                this.typeHint(
                    ": ",
                    this.withTyping("Callable"),
                    "[[",
                    this.withTyping("Any"),
                    "], ",
                    tvar,
                    "]",
                ),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", this.withTyping("List"), "[", tvar, "]"),
                ":",
            ],
            () => {
                this.emitLine("assert isinstance(x, list)");
                this.emitLine("return [f(y) for y in x]");
            },
        );
    }

    protected emitToClassConverter(): void {
        const tvar = this.typeVar();
        this.emitBlock(
            [
                "def to_class(c",
                this.typeHint(": ", this.withTyping("Type"), "[", tvar, "]"),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> dict"),
                ":",
            ],
            () => {
                this.emitLine("assert isinstance(x, c)");
                this.emitLine(
                    "return ",
                    this.cast(this.withTyping("Any"), "x"),
                    ".to_dict()",
                );
            },
        );
    }

    protected emitDictConverter(): void {
        const tvar = this.typeVar();
        this.emitBlock(
            [
                "def from_dict(f",
                this.typeHint(
                    ": ",
                    this.withTyping("Callable"),
                    "[[",
                    this.withTyping("Any"),
                    "], ",
                    tvar,
                    "]",
                ),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(
                    " -> ",
                    this.withTyping("Dict"),
                    "[str, ",
                    tvar,
                    "]",
                ),
                ":",
            ],
            () => {
                this.emitLine("assert isinstance(x, dict)");
                this.emitLine("return { k: f(v) for (k, v) in x.items() }");
            },
        );
    }

    // This is not easily idiomatically typeable in Python.  See
    // https://stackoverflow.com/questions/51066468/computed-types-in-mypy/51084497
    protected emitUnionConverter(): void {
        this.emitMultiline(`def from_union(fs, x):
    for f in fs:
        try:
            return f(x)
        except:
            pass
    assert False`);
    }

    protected emitFromDatetimeConverter(): void {
        this.emitBlock(
            [
                "def from_datetime(",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", this.withImport("datetime", "datetime")),
                ":",
            ],
            () => {
                this._haveDateutil = true;
                this.emitLine("return dateutil.parser.parse(x)");
            },
        );
    }

    protected emitFromStringifiedBoolConverter(): void {
        this.emitBlock(
            [
                "def from_stringified_bool(x",
                this.typeHint(": str"),
                ")",
                this.typeHint(" -> bool"),
                ":",
            ],
            () => {
                this.emitBlock('if x == "true":', () =>
                    this.emitLine("return True"),
                );
                this.emitBlock('if x == "false":', () =>
                    this.emitLine("return False"),
                );
                this.emitLine("assert False");
            },
        );
    }

    protected emitIsTypeConverter(): void {
        const tvar = this.typeVar();
        this.emitBlock(
            [
                "def is_type(t",
                this.typeHint(": ", this.withTyping("Type"), "[", tvar, "]"),
                ", ",
                this.typingDecl("x", "Any"),
                ")",
                this.typeHint(" -> ", tvar),
                ":",
            ],
            () => {
                this.emitLine("assert isinstance(x, t)");
                this.emitLine("return x");
            },
        );
    }

    protected emitConverter(cf: ConverterFunction): void {
        switch (cf) {
            case "none": {
                this.emitNoneConverter();
                return;
            }

            case "bool": {
                this.emitBoolConverter();
                return;
            }

            case "int": {
                this.emitIntConverter();
                return;
            }

            case "from-float": {
                this.emitFromFloatConverter();
                return;
            }

            case "to-float": {
                this.emitToFloatConverter();
                return;
            }

            case "str": {
                this.emitStrConverter();
                return;
            }

            case "to-enum": {
                this.emitToEnumConverter();
                return;
            }

            case "list": {
                this.emitListConverter();
                return;
            }

            case "to-class": {
                this.emitToClassConverter();
                return;
            }

            case "dict": {
                this.emitDictConverter();
                return;
            }

            case "union": {
                this.emitUnionConverter();
                return;
            }

            case "from-datetime": {
                this.emitFromDatetimeConverter();
                return;
            }

            case "from-stringified-bool": {
                this.emitFromStringifiedBoolConverter();
                return;
            }

            case "is-type": {
                this.emitIsTypeConverter();
                return;
            }

            default:
                assertNever(cf);
        }
    }

    // Return the name of the Python converter function `cf`.
    protected conv(cf: ConverterFunction): Sourcelike {
        this._deserializerFunctions.add(cf);
        const name = cf.replace(/-/g, "_");
        if (
            cf.startsWith("from-") ||
            cf.startsWith("to-") ||
            cf.startsWith("is-")
        )
            return name;
        return ["from_", name];
    }

    // Applies the converter function to `arg`
    protected convFn(cf: ConverterFunction, arg: ValueOrLambda): ValueOrLambda {
        return compose(arg, {
            lambda: singleWord(this.conv(cf)),
            value: undefined,
        });
    }

    protected typeObject(t: Type): Sourcelike {
        const s = matchType<Sourcelike | undefined>(
            t,
            (_anyType) => undefined,
            (_nullType) => "type(None)",
            (_boolType) => "bool",
            (_integerType) => "int",
            (_doubleType) => "float",
            (_stringType) => "str",
            (_arrayType) => "List",
            (classType) => this.nameForNamedType(classType),
            (_mapType) => "dict",
            (enumType) => this.nameForNamedType(enumType),
            (_unionType) => undefined,
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    return this.withImport("datetime", "datetime");
                }

                if (transformedStringType.kind === "uuid") {
                    return this.withImport("uuid", "UUID");
                }

                return undefined;
            },
        );
        if (s === undefined) {
            return panic(`No type object for ${t.kind}`);
        }

        return s;
    }

    protected transformer(
        inputTransformer: ValueOrLambda,
        xfer: Transformer,
        targetType: Type,
    ): ValueOrLambda {
        const consume = (
            consumer: Transformer | undefined,
            vol: ValueOrLambda,
        ): ValueOrLambda => {
            if (consumer === undefined) {
                return vol;
            }

            return this.transformer(vol, consumer, targetType);
        };

        const isType = (
            t: Type,
            valueToCheck: ValueOrLambda,
        ): ValueOrLambda => {
            return compose(valueToCheck, (v) => [
                this.conv("is-type"),
                "(",
                this.typeObject(t),
                ", ",
                v,
                ")",
            ]);
        };

        if (
            xfer instanceof DecodingChoiceTransformer ||
            xfer instanceof ChoiceTransformer
        ) {
            const lambdas = xfer.transformers.map(
                (x) =>
                    makeLambda(this.transformer(identity, x, targetType))
                        .source,
            );
            return compose(inputTransformer, (v) => [
                this.conv("union"),
                "([",
                arrayIntercalate(", ", lambdas),
                "], ",
                v,
                ")",
            ]);
        }
        if (xfer instanceof DecodingTransformer) {
            const consumer = xfer.consumer;
            const vol = this.deserializer(inputTransformer, xfer.sourceType);
            return consume(consumer, vol);
        }
        if (xfer instanceof EncodingTransformer) {
            return this.serializer(inputTransformer, xfer.sourceType);
        }
        if (xfer instanceof UnionInstantiationTransformer) {
            return inputTransformer;
        }
        if (xfer instanceof UnionMemberMatchTransformer) {
            const consumer = xfer.transformer;
            const vol = isType(xfer.memberType, inputTransformer);
            return consume(consumer, vol);
        }
        if (xfer instanceof ParseStringTransformer) {
            const consumer = xfer.consumer;
            const immediateTargetType =
                consumer === undefined ? targetType : consumer.sourceType;
            let vol: ValueOrLambda;
            switch (immediateTargetType.kind) {
                case "integer":
                    vol = compose(inputTransformer, (v) => ["int(", v, ")"]);
                    break;
                case "bool":
                    vol = this.convFn(
                        "from-stringified-bool",
                        inputTransformer,
                    );
                    break;
                case "enum":
                    vol = this.deserializer(
                        inputTransformer,
                        immediateTargetType,
                    );
                    break;
                case "date-time":
                    vol = this.convFn("from-datetime", inputTransformer);
                    break;
                case "uuid":
                    vol = compose(inputTransformer, (v) => [
                        this.withImport("uuid", "UUID"),
                        "(",
                        v,
                        ")",
                    ]);
                    break;
                default:
                    return panic(
                        `Parsing of ${immediateTargetType.kind} in a transformer is not supported`,
                    );
            }

            return consume(consumer, vol);
        }
        if (xfer instanceof StringifyTransformer) {
            const consumer = xfer.consumer;
            let vol: ValueOrLambda;
            switch (xfer.sourceType.kind) {
                case "integer":
                    vol = compose(inputTransformer, (v) => ["str(", v, ")"]);
                    break;
                case "bool":
                    vol = compose(inputTransformer, (v) => [
                        "str(",
                        v,
                        ").lower()",
                    ]);
                    break;
                case "enum":
                    vol = this.serializer(inputTransformer, xfer.sourceType);
                    break;
                case "date-time":
                    vol = compose(inputTransformer, (v) => [v, ".isoformat()"]);
                    break;
                case "uuid":
                    vol = compose(inputTransformer, (v) => ["str(", v, ")"]);
                    break;
                default:
                    return panic(
                        `Parsing of ${xfer.sourceType.kind} in a transformer is not supported`,
                    );
            }

            return consume(consumer, vol);
        }

        return panic(`Transformer ${xfer.kind} is not supported`);
    }

    // Returns the code to deserialize `value` as type `t`.  If `t` has
    // an associated transformer, the code for that transformer is
    // returned.
    protected deserializer(value: ValueOrLambda, t: Type): ValueOrLambda {
        const xf = transformationForType(t);
        if (xf !== undefined) {
            return this.transformer(value, xf.transformer, xf.targetType);
        }

        return matchType<ValueOrLambda>(
            t,
            (_anyType) => value,
            (_nullType) => this.convFn("none", value),
            (_boolType) => this.convFn("bool", value),
            (_integerType) => this.convFn("int", value),
            (_doubleType) => this.convFn("from-float", value),
            (_stringType) => this.convFn("str", value),
            (arrayType) =>
                compose(value, (v) => [
                    this.conv("list"),
                    "(",
                    makeLambda(this.deserializer(identity, arrayType.items))
                        .source,
                    ", ",
                    v,
                    ")",
                ]),
            (classType) =>
                compose(value, {
                    lambda: singleWord(
                        this.nameForNamedType(classType),
                        ".from_dict",
                    ),
                    value: undefined,
                }),
            (mapType) =>
                compose(value, (v) => [
                    this.conv("dict"),
                    "(",
                    makeLambda(this.deserializer(identity, mapType.values))
                        .source,
                    ", ",
                    v,
                    ")",
                ]),
            (enumType) =>
                compose(value, {
                    lambda: singleWord(this.nameForNamedType(enumType)),
                    value: undefined,
                }),
            (unionType) => {
                // FIXME: handle via transformers
                const deserializers = Array.from(unionType.members).map(
                    (m) => makeLambda(this.deserializer(identity, m)).source,
                );
                return compose(value, (v) => [
                    this.conv("union"),
                    "([",
                    arrayIntercalate(", ", deserializers),
                    "], ",
                    v,
                    ")",
                ]);
            },
            (transformedStringType) => {
                // FIXME: handle via transformers
                if (transformedStringType.kind === "date-time") {
                    return this.convFn("from-datetime", value);
                }

                if (transformedStringType.kind === "uuid") {
                    return compose(value, (v) => [
                        this.withImport("uuid", "UUID"),
                        "(",
                        v,
                        ")",
                    ]);
                }

                return panic(
                    `Transformed type ${transformedStringType.kind} not supported`,
                );
            },
        );
    }

    protected serializer(value: ValueOrLambda, t: Type): ValueOrLambda {
        const xf = transformationForType(t);
        if (xf !== undefined) {
            const reverse = xf.reverse;
            return this.transformer(
                value,
                reverse.transformer,
                reverse.targetType,
            );
        }

        return matchType<ValueOrLambda>(
            t,
            (_anyType) => value,
            (_nullType) => this.convFn("none", value),
            (_boolType) => this.convFn("bool", value),
            (_integerType) => this.convFn("int", value),
            (_doubleType) => this.convFn("to-float", value),
            (_stringType) => this.convFn("str", value),
            (arrayType) =>
                compose(value, (v) => [
                    this.conv("list"),
                    "(",
                    makeLambda(this.serializer(identity, arrayType.items))
                        .source,
                    ", ",
                    v,
                    ")",
                ]),
            (classType) =>
                compose(value, (v) => [
                    this.conv("to-class"),
                    "(",
                    this.nameForNamedType(classType),
                    ", ",
                    v,
                    ")",
                ]),
            (mapType) =>
                compose(value, (v) => [
                    this.conv("dict"),
                    "(",
                    makeLambda(this.serializer(identity, mapType.values))
                        .source,
                    ", ",
                    v,
                    ")",
                ]),
            (enumType) =>
                compose(value, (v) => [
                    this.conv("to-enum"),
                    "(",
                    this.nameForNamedType(enumType),
                    ", ",
                    v,
                    ")",
                ]),
            (unionType) => {
                const serializers = Array.from(unionType.members).map(
                    (m) => makeLambda(this.serializer(identity, m)).source,
                );
                return compose(value, (v) => [
                    this.conv("union"),
                    "([",
                    arrayIntercalate(", ", serializers),
                    "], ",
                    v,
                    ")",
                ]);
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "date-time") {
                    return compose(value, (v) => [v, ".isoformat()"]);
                }

                if (transformedStringType.kind === "uuid") {
                    return compose(value, (v) => ["str(", v, ")"]);
                }

                return panic(
                    `Transformed type ${transformedStringType.kind} not supported`,
                );
            },
        );
    }

    protected emitClassMembers(t: ClassType): void {
        super.emitClassMembers(t);
        this.ensureBlankLine();

        const className = this.nameForNamedType(t);

        this.emitLine("@staticmethod");
        this.emitBlock(
            [
                "def from_dict(",
                this.typingDecl("obj", "Any"),
                ")",
                this.typeHint(" -> ", this.namedType(t)),
                ":",
            ],
            () => {
                const args: Sourcelike[] = [];
                this.emitLine("assert isinstance(obj, dict)");
                this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                    const property = {
                        value: ["obj.get(", this.string(jsonName), ")"],
                    };
                    this.emitLine(
                        name,
                        " = ",
                        makeValue(this.deserializer(property, cp.type)),
                    );
                    args.push(name);
                });
                this.emitLine(
                    "return ",
                    className,
                    "(",
                    arrayIntercalate(", ", args),
                    ")",
                );
            },
        );
        this.ensureBlankLine();

        this.emitBlock(
            ["def to_dict(self)", this.typeHint(" -> dict"), ":"],
            () => {
                this.emitLine("result", this.typeHint(": dict"), " = {}");
                this.forEachClassProperty(t, "none", (name, jsonName, cp) => {
                    const property = { value: ["self.", name] };
                    if (cp.isOptional) {
                        this.emitBlock(
                            ["if self.", name, " is not None:"],
                            () => {
                                this.emitLine(
                                    "result[",
                                    this.string(jsonName),
                                    "] = ",
                                    makeValue(
                                        this.serializer(property, cp.type),
                                    ),
                                );
                            },
                        );
                    } else {
                        this.emitLine(
                            "result[",
                            this.string(jsonName),
                            "] = ",
                            makeValue(this.serializer(property, cp.type)),
                        );
                    }
                });
                this.emitLine("return result");
            },
        );
    }

    protected emitImports(): void {
        super.emitImports();
        if (this._haveDateutil) {
            this.emitLine("import dateutil.parser");
        }

        if (!this._haveTypeVar && !this._haveEnumTypeVar) return;

        this.ensureBlankLine(2);
        if (this._haveTypeVar) {
            this.emitTypeVar(this.typeVar(), []);
        }

        if (this._haveEnumTypeVar) {
            this.emitTypeVar(this.enumTypeVar(), [
                ", bound=",
                this.withImport("enum", "Enum"),
            ]);
        }
    }

    protected emitSupportCode(): void {
        const map = Array.from(this._deserializerFunctions).map(
            (f) => [f, f] as [ConverterFunction, ConverterFunction],
        );
        this.forEachWithBlankLines(map, ["interposing", 2], (cf) => {
            this.emitConverter(cf);
        });
    }

    protected makeTopLevelDependencyNames(
        _t: Type,
        topLevelName: Name,
    ): DependencyName[] {
        const fromDict = new DependencyName(
            this._converterNamer,
            topLevelNameOrder,
            (l) => `${l(topLevelName)}_from_dict`,
        );
        const toDict = new DependencyName(
            this._converterNamer,
            topLevelNameOrder,
            (l) => `${l(topLevelName)}_to_dict`,
        );
        this._topLevelConverterNames.set(topLevelName, { fromDict, toDict });
        return [fromDict, toDict];
    }

    protected emitDefaultLeadingComments(): void {
        this.ensureBlankLine();
        if (this._haveDateutil) {
            this.emitCommentLines([
                "This code parses date/times, so please",
                "",
                "    pip install python-dateutil",
                "",
            ]);
        }

        this.emitCommentLines([
            "To use this code, make sure you",
            "",
            "    import json",
            "",
            "and then, to convert JSON from a string, do",
            "",
        ]);
        this.forEachTopLevel("none", (_, name) => {
            const { fromDict } = defined(
                this._topLevelConverterNames.get(name),
            );
            this.emitLine(
                this.commentLineStart,
                "    result = ",
                fromDict,
                "(json.loads(json_string))",
            );
        });
    }

    protected emitClosingCode(): void {
        this.forEachTopLevel(["interposing", 2], (t, name) => {
            const { fromDict, toDict } = defined(
                this._topLevelConverterNames.get(name),
            );
            const pythonType = this.pythonType(t);
            this.emitBlock(
                [
                    "def ",
                    fromDict,
                    "(",
                    this.typingDecl("s", "Any"),
                    ")",
                    this.typeHint(" -> ", pythonType),
                    ":",
                ],
                () => {
                    this.emitLine(
                        "return ",
                        makeValue(this.deserializer({ value: "s" }, t)),
                    );
                },
            );
            this.ensureBlankLine(2);
            this.emitBlock(
                [
                    "def ",
                    toDict,
                    "(x",
                    this.typeHint(": ", pythonType),
                    ")",
                    this.typingReturn("Any"),
                    ":",
                ],
                () => {
                    this.emitLine(
                        "return ",
                        makeValue(this.serializer({ value: "x" }, t)),
                    );
                },
            );
        });
    }
}

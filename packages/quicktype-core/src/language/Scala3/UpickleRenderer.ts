import type { Name } from "../../Naming.js";
import type { Sourcelike } from "../../Source.js";
import { removeNullFromUnion } from "../../Type/TypeUtils.js";
import type { ClassType, EnumType, Type, UnionType } from "../../Type/index.js";
import { stringEscape, utf16StringEscape } from "../../support/Strings.js";

import { Scala3Renderer } from "./Scala3Renderer.js";
import {
    propertyNameNeedsMapping,
    unionMemberSortOrder,
    wrapOption,
} from "./utils.js";

export class UpickleRenderer extends Scala3Renderer {
    private readonly seenUnionTypes: string[] = [];

    protected emitClassDefinitionMethods(
        _c: ClassType,
        _className: Name,
    ): void {
        this.emitLine(") derives OptionPickler.ReadWriter");
    }

    protected emitPropertyAnnotation(_name: Name, jsonName: string): void {
        if (propertyNameNeedsMapping(jsonName)) {
            this.emitLine(
                `@upickle.implicits.key("${utf16StringEscape(jsonName)}")`,
            );
        }
    }

    protected anySourceType(optional: boolean): Sourcelike {
        return [wrapOption("ujson.Value", optional)];
    }

    protected emitHeader(): void {
        super.emitHeader();
        this.emitMultiline(`// Custom pickler so that missing keys and JSON nulls both read as None,
// and None is left out when writing (upickle's default for Option is a
// JSON array).
object OptionPickler extends upickle.AttributeTagged:
    import upickle.default.Writer
    import upickle.default.Reader
    override implicit def OptionWriter[T: Writer]: Writer[Option[T]] =
        implicitly[Writer[T]].comap[Option[T]] {
            case None => null.asInstanceOf[T]
            case Some(x) => x
        }

    override implicit def OptionReader[T: Reader]: Reader[Option[T]] = {
        new Reader.Delegate[Any, Option[T]](implicitly[Reader[T]].map(Some(_))){
        override def visitNull(index: Int) = None
        }
    }
end OptionPickler

// If a union has a null in, then we'll need this too...
type NullValue = None.type
given OptionPickler.ReadWriter[NullValue] = OptionPickler.readwriter[ujson.Value].bimap[NullValue](
    _ => ujson.Null,
    json => if json.isNull then None else throw new upickle.core.Abort("not null")
)

object JsonExt:
    val valueReader = OptionPickler.readwriter[ujson.Value]

    // upickle's built-in primitive readers are lenient -- the numeric and
    // boolean readers accept strings, and the string reader accepts
    // numbers and booleans -- so untagged unions need strict readers to
    // pick the right member.
    val strictString: OptionPickler.Reader[String] = valueReader.map {
        case ujson.Str(s) => s
        case json => throw new upickle.core.Abort("expected string, got " + json)
    }
    val strictLong: OptionPickler.Reader[Long] = valueReader.map {
        case ujson.Num(n) if n.isWhole => n.toLong
        case json => throw new upickle.core.Abort("expected integer, got " + json)
    }
    val strictDouble: OptionPickler.Reader[Double] = valueReader.map {
        case ujson.Num(n) => n
        case json => throw new upickle.core.Abort("expected number, got " + json)
    }
    val strictBoolean: OptionPickler.Reader[Boolean] = valueReader.map {
        case ujson.Bool(b) => b
        case json => throw new upickle.core.Abort("expected boolean, got " + json)
    }

    def badMerge[T](r1: => OptionPickler.Reader[?], rest: OptionPickler.Reader[?]*): OptionPickler.Reader[T] = valueReader.map { json =>
        var t: T | Null = null
        val stack       = Vector.newBuilder[Throwable]
        (r1 +: rest).foreach { reader =>
            if t == null then
            try
                t = OptionPickler.read[T](json, trace = true)(using reader.asInstanceOf[OptionPickler.Reader[T]])
            catch
                case exc => stack += exc
        }
        if t != null then t.nn else throw new Exception(json.toString(), stack.result().headOption.getOrElse(null))
    }
end JsonExt
`);
        this.ensureBlankLine();
    }

    protected override emitEmptyClassDefinition(
        c: ClassType,
        className: Name,
    ): void {
        super.emitEmptyClassDefinition(c, className);
        this.emitItem(" derives OptionPickler.ReadWriter");
        this.ensureBlankLine();
    }

    protected override emitUnionDefinition(
        u: UnionType,
        unionName: Name,
    ): void {
        this.emitDescription(this.descriptionForType(u));

        const [maybeNull, nonNulls] = removeNullFromUnion(u, false);
        const theTypes: Sourcelike[] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_, t) => {
            theTypes.push(this.scalaType(t));
        });
        if (maybeNull !== null) {
            theTypes.push(this.nameForUnionMember(u, maybeNull));
        }

        this.emitItem(["type ", unionName, " = "]);
        theTypes.forEach((t, i) => {
            this.emitItem(i === 0 ? t : [" | ", t]);
        });
        const thisUnionType = theTypes
            .map((x) => this.sourcelikeToString(x))
            .join(" | ");

        this.ensureBlankLine();
        if (!this.seenUnionTypes.some((y) => y === thisUnionType)) {
            this.seenUnionTypes.push(thisUnionType);
            const sourceLikeTypes: Array<[Sourcelike, Type]> = [];
            this.forEachUnionMember(
                u,
                nonNulls,
                "none",
                unionMemberSortOrder,
                (_, t) => {
                    sourceLikeTypes.push([this.scalaType(t), t]);
                },
            );
            if (maybeNull !== null) {
                sourceLikeTypes.push([
                    this.nameForUnionMember(u, maybeNull),
                    maybeNull,
                ]);
            }

            this.ensureBlankLine();
            this.emitLine([
                "given unionReader",
                unionName,
                ": OptionPickler.Reader[",
                unionName,
                "] = JsonExt.badMerge[",
                unionName,
                "](",
            ]);
            this.indent(() => {
                sourceLikeTypes.forEach(([srcType, t]) => {
                    // Use the strict readers for primitive members --
                    // upickle's built-in ones accept too much (see the
                    // comment in the emitted JsonExt).
                    const strictReaders: Partial<Record<string, string>> = {
                        Boolean: "JsonExt.strictBoolean",
                        Double: "JsonExt.strictDouble",
                        Long: "JsonExt.strictLong",
                        String: "JsonExt.strictString",
                    };
                    const strict = t.isPrimitive()
                        ? strictReaders[this.sourcelikeToString(srcType)]
                        : undefined;
                    if (strict === undefined) {
                        this.emitLine([
                            "summon[OptionPickler.Reader[",
                            srcType,
                            "]],",
                        ]);
                    } else {
                        this.emitLine([strict, ","]);
                    }
                });
                this.emitLine(")");
            });
            this.ensureBlankLine();
            this.emitLine([
                "given unionWriter",
                unionName,
                ": OptionPickler.Writer[",
                unionName,
                "] = OptionPickler.writer[ujson.Value].comap[",
                unionName,
                "]{ _v =>",
            ]);
            this.indent(() => {
                this.emitLine("(_v: @unchecked) match ");
                this.indent(() => {
                    sourceLikeTypes.forEach((t) => {
                        this.emitLine([
                            "case v: ",
                            t[0],
                            " => OptionPickler.writeJs[",
                            t[0],
                            "](v)",
                        ]);
                    });
                });
            });
            this.emitLine("}");
        }
    }

    protected emitEnumDefinition(e: EnumType, enumName: Name): void {
        this.emitDescription(this.descriptionForType(e));
        this.ensureBlankLine();

        // Enum cases are styled Scala identifiers; the ReadWriter below
        // maps them back to the original JSON strings, which can be
        // anything (keywords, `"_"`, `""`, …).
        this.emitLine(["enum ", enumName, " : "]);
        this.indent(() => {
            this.forEachEnumCase(e, "none", (name) => {
                this.emitLine("case ", name);
            });
        });
        this.ensureBlankLine();

        this.emitLine([
            "given OptionPickler.ReadWriter[",
            enumName,
            "] = OptionPickler.readwriter[String].bimap[",
            enumName,
            "](",
        ]);
        this.indent(() => {
            this.emitLine("{");
            this.indent(() => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine([
                        "case ",
                        enumName,
                        ".",
                        name,
                        ` => "${stringEscape(jsonName)}"`,
                    ]);
                });
            });
            this.emitLine("},");
            this.emitLine("{");
            this.indent(() => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine([
                        `case "${stringEscape(jsonName)}" => `,
                        enumName,
                        ".",
                        name,
                    ]);
                });
                this.emitLine([
                    'case other => throw new upickle.core.Abort("invalid ',
                    enumName,
                    ': " + other)',
                ]);
            });
            this.emitLine("}");
        });
        this.emitLine(")");
        this.ensureBlankLine();
    }
}

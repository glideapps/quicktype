import { KotlinRenderer } from ".";

import { Name } from "../../Naming";
import { TargetLanguage } from "../../TargetLanguage";
import { TypeGraph } from "../../TypeGraph";
import { MapType, ArrayType, PrimitiveType, Type, UnionType } from "../../Type";
import { OrderedSet } from "immutable";

export class KotlinMoshiRenderer extends KotlinRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        _package: string
    ) {
        super(targetLanguage, graph, leadingComments, _package);
    }

    protected frameworkName(): string | undefined {
        return "Moshi";
    }

    protected frameworkForbiddenNames(): string[] {
        return super.frameworkForbiddenNames().concat(["Moshi", "KotlinJsonAdapterFactory"]);
    }

    protected frameworkImports(): string[] {
        return super
            .frameworkImports()
            .concat(["com.squareup.moshi.*", "com.squareup.moshi.kotlin.KotlinJsonAdapterFactory"]);
    }

    protected emitFrameworkPreface(): void {
        this.emitLine("private val moshi = Moshi.Builder()");
        this.indent(() => {
            this.emitLine(".add(KotlinJsonAdapterFactory())");
            this.forEachEnum("none", (_, name) => {
                this.emitLine(".add(object {");
                this.indent(() => {
                    this.emitLine("@ToJson fun toJson(e: ", name, ") = e.value");
                    this.emitLine("@FromJson fun fromJson(v: String) = ", name, ".fromValue(v)");
                });
                this.emitLine("})");
            });
            this.emitLine(".build()");
        });
    }

    protected emitClassBody(className: Name): void {
        this.emitLine("public fun toJson() = ", className, ".adapter.toJson(this)");
        this.ensureBlankLine();
        this.emitBlock("companion object", () => {
            this.emitLine("val adapter = moshi.adapter(", className, "::class.java)");
            this.emitLine("public fun fromJson(json: String) = adapter.fromJson(json)");
        });
    }

    protected emitUnionBody(
        _u: UnionType,
        _unionName: Name,
        _maybeNull: PrimitiveType | null,
        _nonNulls: OrderedSet<Type>
    ): void {
        this.emitLine("// TODO");
    }

    protected emitTopLevelArrayBody(_t: ArrayType, _name: Name): void {
        this.emitLine("// TODO");
    }

    protected emitTopLevelMapBody(_t: MapType, _name: Name): void {
        this.emitLine("// TODO");
    }
}

import stringHash = require("string-hash");

import { UnionType, Type, EnumType, PrimitiveType } from "./Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { panic, addHashCode, assert, mapOptional, indentationString } from "./support/Support";
import { BaseGraphRewriteBuilder } from "./GraphRewriting";
import { setUnionInto, areEqual, hashCodeOf } from "./support/Containers";
import { TypeRef, derefTypeRef, TypeGraph } from "./TypeGraph";

function debugStringForType(t: Type): string {
    const target = followTargetType(t);
    if (t === target) {
        return t.kind;
    }
    return `${t.kind} (${target.kind})`;
}

export abstract class Transformer {
    constructor(readonly kind: string, protected readonly graph: TypeGraph, readonly sourceTypeRef: TypeRef) {}

    get sourceType(): Type {
        return derefTypeRef(this.sourceTypeRef, this.graph);
    }

    /** This must return a newly constructed set. */
    getChildren(): Set<Type> {
        return new Set([this.sourceType]);
    }

    abstract reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;

    abstract reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;

    equals(other: any): boolean {
        if (!(other instanceof Transformer)) return false;
        return this.sourceTypeRef === other.sourceTypeRef;
    }

    hashCode(): number {
        return hashCodeOf(this.sourceTypeRef);
    }

    protected debugDescription(): string {
        return `${debugStringForType(this.sourceType)} -> ${this.kind}`;
    }

    protected debugPrintContinuations(_indent: number): void {
        return;
    }

    debugPrint(indent: number): void {
        console.log(indentationString(indent) + this.debugDescription());
        this.debugPrintContinuations(indent + 1);
    }
}

export abstract class ProducerTransformer extends Transformer {
    constructor(kind: string, graph: TypeGraph, sourceTypeRef: TypeRef, readonly consumer: Transformer | undefined) {
        super(kind, graph, sourceTypeRef);
    }

    getChildren(): Set<Type> {
        const children = super.getChildren();
        if (this.consumer === undefined) return children;
        return setUnionInto(children, this.consumer.getChildren());
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ProducerTransformer)) return false;
        return areEqual(this.consumer, other.consumer);
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this.consumer));
    }

    protected debugPrintContinuations(indent: number): void {
        if (this.consumer === undefined) return;
        this.consumer.debugPrint(indent);
    }
}

export abstract class MatchTransformer extends Transformer {
    constructor(kind: string, graph: TypeGraph, sourceTypeRef: TypeRef, readonly transformer: Transformer) {
        super(kind, graph, sourceTypeRef);
    }

    getChildren(): Set<Type> {
        return setUnionInto(super.getChildren(), this.transformer.getChildren());
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof MatchTransformer)) return false;
        return this.transformer.equals(other.transformer);
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, this.transformer.hashCode());
    }

    protected debugPrintContinuations(indent: number): void {
        this.transformer.debugPrint(indent);
    }
}

export class DecodingTransformer extends ProducerTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined) {
        super("decode", graph, sourceTypeRef, consumer);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer !== undefined) {
            return panic("Reversing a decoding transformer cannot have a continuation");
        }

        if (this.consumer === undefined) {
            return new EncodingTransformer(this.graph, targetTypeRef);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new EncodingTransformer(this.graph, this.consumer.sourceTypeRef)
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new DecodingTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            mapOptional(xfer => xfer.reconstitute(builder), this.consumer)
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof StringProducerTransformer;
    }
}

export class EncodingTransformer extends Transformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef) {
        super("encode", graph, sourceTypeRef);
    }

    reverse(_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer {
        return panic("Can't reverse encoding transformer");
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new EncodingTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef));
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof EncodingTransformer)) return false;
        return true;
    }
}

export class ChoiceTransformer extends Transformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, public readonly transformers: ReadonlyArray<Transformer>) {
        super("choice", graph, sourceTypeRef);
    }

    getChildren(): Set<Type> {
        let children = super.getChildren();
        for (const xfer of this.transformers) {
            setUnionInto(children, xfer.getChildren());
        }
        return children;
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        const transformers = this.transformers.map(xfer => xfer.reverse(targetTypeRef, continuationTransformer));
        return new ChoiceTransformer(this.graph, targetTypeRef, transformers);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new ChoiceTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformers.map(xfer => xfer.reconstitute(builder))
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ChoiceTransformer)) return false;
        return areEqual(this.transformers, other.transformers);
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this.transformers));
    }

    protected debugPrintContinuations(indent: number): void {
        for (const xfer of this.transformers) {
            xfer.debugPrint(indent);
        }
    }
}

export class DecodingChoiceTransformer extends Transformer {
    constructor(
        graph: TypeGraph,
        sourceTypeRef: TypeRef,
        readonly nullTransformer: Transformer | undefined,
        readonly integerTransformer: Transformer | undefined,
        readonly doubleTransformer: Transformer | undefined,
        readonly boolTransformer: Transformer | undefined,
        readonly stringTransformer: Transformer | undefined,
        readonly arrayTransformer: Transformer | undefined,
        readonly objectTransformer: Transformer | undefined
    ) {
        super("decoding-choice", graph, sourceTypeRef);
    }

    getChildren(): Set<Type> {
        let children = super.getChildren();
        if (this.nullTransformer !== undefined) {
            setUnionInto(children, this.nullTransformer.getChildren());
        }
        if (this.integerTransformer !== undefined) {
            setUnionInto(children, this.integerTransformer.getChildren());
        }
        if (this.doubleTransformer !== undefined) {
            setUnionInto(children, this.doubleTransformer.getChildren());
        }
        if (this.boolTransformer !== undefined) {
            setUnionInto(children, this.boolTransformer.getChildren());
        }
        if (this.stringTransformer !== undefined) {
            setUnionInto(children, this.stringTransformer.getChildren());
        }
        if (this.arrayTransformer !== undefined) {
            setUnionInto(children, this.arrayTransformer.getChildren());
        }
        if (this.objectTransformer !== undefined) {
            setUnionInto(children, this.objectTransformer.getChildren());
        }
        return children;
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        assert(
            continuationTransformer === undefined,
            "Reversing a decoding transformer can't have a target transformer"
        );

        let transformers: Transformer[] = [];

        const addCase = (transformer: Transformer | undefined) => {
            if (transformer === undefined) return;
            transformers.push(
                transformer.reverse(targetTypeRef, new EncodingTransformer(this.graph, transformer.sourceTypeRef))
            );
        };

        addCase(this.nullTransformer);
        addCase(this.integerTransformer);
        addCase(this.doubleTransformer);
        addCase(this.boolTransformer);
        addCase(this.stringTransformer);
        addCase(this.arrayTransformer);
        addCase(this.objectTransformer);

        return new ChoiceTransformer(this.graph, targetTypeRef, transformers);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        function reconstitute(xf: Transformer | undefined) {
            if (xf === undefined) return undefined;
            return xf.reconstitute(builder);
        }

        return new DecodingChoiceTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            reconstitute(this.nullTransformer),
            reconstitute(this.integerTransformer),
            reconstitute(this.doubleTransformer),
            reconstitute(this.boolTransformer),
            reconstitute(this.stringTransformer),
            reconstitute(this.arrayTransformer),
            reconstitute(this.objectTransformer)
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof DecodingChoiceTransformer)) return false;
        if (!areEqual(this.nullTransformer, other.nullTransformer)) return false;
        if (!areEqual(this.integerTransformer, other.integerTransformer)) return false;
        if (!areEqual(this.doubleTransformer, other.doubleTransformer)) return false;
        if (!areEqual(this.boolTransformer, other.boolTransformer)) return false;
        if (!areEqual(this.stringTransformer, other.stringTransformer)) return false;
        if (!areEqual(this.arrayTransformer, other.arrayTransformer)) return false;
        if (!areEqual(this.objectTransformer, other.objectTransformer)) return false;
        return true;
    }

    hashCode(): number {
        let h = super.hashCode();
        h = addHashCode(h, hashCodeOf(this.nullTransformer));
        h = addHashCode(h, hashCodeOf(this.integerTransformer));
        h = addHashCode(h, hashCodeOf(this.doubleTransformer));
        h = addHashCode(h, hashCodeOf(this.boolTransformer));
        h = addHashCode(h, hashCodeOf(this.stringTransformer));
        h = addHashCode(h, hashCodeOf(this.arrayTransformer));
        h = addHashCode(h, hashCodeOf(this.objectTransformer));
        return h;
    }

    protected debugPrintContinuations(indent: number): void {
        if (this.nullTransformer !== undefined) this.nullTransformer.debugPrint(indent);
        if (this.integerTransformer !== undefined) this.integerTransformer.debugPrint(indent);
        if (this.doubleTransformer !== undefined) this.doubleTransformer.debugPrint(indent);
        if (this.boolTransformer !== undefined) this.boolTransformer.debugPrint(indent);
        if (this.stringTransformer !== undefined) this.stringTransformer.debugPrint(indent);
        if (this.arrayTransformer !== undefined) this.arrayTransformer.debugPrint(indent);
        if (this.objectTransformer !== undefined) this.objectTransformer.debugPrint(indent);
    }
}

export class UnionMemberMatchTransformer extends MatchTransformer {
    constructor(
        graph: TypeGraph,
        sourceTypeRef: TypeRef,
        transformer: Transformer,
        private readonly _memberTypeRef: TypeRef
    ) {
        super("union-member-match", graph, sourceTypeRef, transformer);
    }

    get sourceType(): UnionType {
        const t = derefTypeRef(this.sourceTypeRef, this.graph);
        if (!(t instanceof UnionType)) {
            return panic("The source of a union member match transformer must be a union type");
        }
        return t;
    }

    get memberType(): Type {
        return derefTypeRef(this._memberTypeRef, this.graph);
    }

    getChildren(): Set<Type> {
        return super.getChildren().add(this.memberType);
    }

    reverse(_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer {
        return panic("Can't reverse union member match transformer");
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new UnionMemberMatchTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformer.reconstitute(builder),
            builder.reconstituteTypeRef(this._memberTypeRef)
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof UnionMemberMatchTransformer)) return false;
        return this._memberTypeRef === other._memberTypeRef;
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this._memberTypeRef));
    }

    protected debugDescription(): string {
        return `${super.debugDescription()} - member: ${debugStringForType(this.memberType)}`;
    }
}

/**
 * This matches strings and enum cases.
 */
export class StringMatchTransformer extends MatchTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, transformer: Transformer, readonly stringCase: string) {
        super("string-match", graph, sourceTypeRef, transformer);
    }

    get sourceType(): EnumType | PrimitiveType {
        const t = derefTypeRef(this.sourceTypeRef, this.graph);
        if (!(t instanceof EnumType) && !(t instanceof PrimitiveType && t.kind === "string")) {
            return panic("The source of a string match transformer must be an enum or string type");
        }
        return t;
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        return this.transformer.reverse(
            targetTypeRef,
            new StringProducerTransformer(
                this.graph,
                this.transformer.sourceTypeRef,
                continuationTransformer,
                this.stringCase
            )
        );
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringMatchTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformer.reconstitute(builder),
            this.stringCase
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof StringMatchTransformer)) return false;
        return this.stringCase !== other.stringCase;
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, stringHash(this.stringCase));
    }

    protected debugDescription(): string {
        return `${super.debugDescription()} - case: ${this.stringCase}`;
    }
}

export class UnionInstantiationTransformer extends Transformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef) {
        super("union-instantiation", graph, sourceTypeRef);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer === undefined) {
            return panic("Union instantiation transformer reverse must have a continuation");
        }

        return new UnionMemberMatchTransformer(this.graph, targetTypeRef, continuationTransformer, this.sourceTypeRef);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new UnionInstantiationTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef));
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof UnionInstantiationTransformer;
    }
}

/**
 * Produces a string or an enum case.
 */
export class StringProducerTransformer extends ProducerTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined, readonly result: string) {
        super("string-producer", graph, sourceTypeRef, consumer);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer === undefined) {
            return panic("Reversing a string producer transformer must have a continuation");
        }

        if (this.consumer === undefined) {
            return new StringMatchTransformer(this.graph, targetTypeRef, continuationTransformer, this.result);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new StringMatchTransformer(
                    this.graph,
                    this.consumer.sourceTypeRef,
                    continuationTransformer,
                    this.result
                )
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringProducerTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            mapOptional(xfer => xfer.reconstitute(builder), this.consumer),
            this.result
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof StringProducerTransformer)) return false;
        return this.result === other.result;
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this.consumer));
    }

    protected debugDescription(): string {
        return `${super.debugDescription()} - result: ${this.result}`;
    }
}

export class ParseDateTimeTransformer extends ProducerTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined) {
        super("parse-date-time", graph, sourceTypeRef, consumer);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (this.consumer === undefined) {
            return new StringifyDateTimeTransformer(this.graph, targetTypeRef, continuationTransformer);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new StringifyDateTimeTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer)
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new ParseDateTimeTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            mapOptional(xfer => xfer.reconstitute(builder), this.consumer)
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof ParseDateTimeTransformer;
    }
}

export class StringifyDateTimeTransformer extends ProducerTransformer {
    constructor(graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined) {
        super("stringify-date-time", graph, sourceTypeRef, consumer);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (this.consumer === undefined) {
            return new ParseDateTimeTransformer(this.graph, targetTypeRef, continuationTransformer);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new ParseDateTimeTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer)
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringifyDateTimeTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            mapOptional(xfer => xfer.reconstitute(builder), this.consumer)
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof StringifyDateTimeTransformer;
    }
}

export class Transformation {
    constructor(
        private readonly _graph: TypeGraph,
        private readonly _targetTypeRef: TypeRef,
        readonly transformer: Transformer
    ) {}

    get sourceType(): Type {
        return this.transformer.sourceType;
    }

    get targetType(): Type {
        return derefTypeRef(this._targetTypeRef, this._graph);
    }

    get reverse(): Transformation {
        return new Transformation(
            this._graph,
            this.transformer.sourceTypeRef,
            this.transformer.reverse(this._targetTypeRef, undefined)
        );
    }

    getChildren(): Set<Type> {
        return this.transformer.getChildren().add(this.targetType);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformation {
        return new Transformation(
            builder.typeGraph,
            builder.reconstituteTypeRef(this._targetTypeRef),
            this.transformer.reconstitute(builder)
        );
    }

    equals(other: any): boolean {
        if (!(other instanceof Transformation)) return false;
        return this._targetTypeRef === other._targetTypeRef && this.transformer.equals(other.transformer);
    }

    hashCode(): number {
        let h = hashCodeOf(this._targetTypeRef);
        h = addHashCode(h, this.transformer.hashCode());
        return h;
    }

    debugPrint(): void {
        this.transformer.debugPrint(0);
        console.log(`-> ${debugStringForType(this.targetType)}`);
    }
}

class TransformationTypeAttributeKind extends TypeAttributeKind<Transformation> {
    constructor() {
        super("transformation");
    }

    get inIdentity(): boolean {
        return true;
    }

    children(xf: Transformation): Set<Type> {
        return xf.getChildren();
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder, xf: Transformation): Transformation {
        return xf.reconstitute(builder);
    }

    stringify(_: Transformation): string {
        return "transformation";
    }
}

export const transformationTypeAttributeKind: TypeAttributeKind<Transformation> = new TransformationTypeAttributeKind();

export function transformationForType(t: Type): Transformation | undefined {
    return transformationTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function followTargetType(t: Type): Type {
    for (;;) {
        const xf = transformationForType(t);
        if (xf === undefined) return t;
        t = xf.targetType;
    }
}

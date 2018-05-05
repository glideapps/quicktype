import { OrderedSet, is, hash, List } from "immutable";

import { UnionType, Type, EnumType, PrimitiveType } from "./Type";
import { TypeAttributeKind } from "./TypeAttributes";
import { TypeRef } from "./TypeBuilder";
import { panic, addHashCode, assert, mapOptional } from "./Support";
import { BaseGraphRewriteBuilder } from "./GraphRewriting";

export abstract class Transformer {
    constructor(readonly sourceTypeRef: TypeRef) {}

    get sourceType(): Type {
        return this.sourceTypeRef.deref()[0];
    }

    getChildren(): OrderedSet<Type> {
        return OrderedSet([this.sourceType]);
    }

    abstract reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;

    abstract reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;

    equals(other: any): boolean {
        if (!(other instanceof Transformer)) return false;
        return this.sourceTypeRef.equals(other.sourceTypeRef);
    }

    hashCode(): number {
        return this.sourceTypeRef.hashCode();
    }
}

export abstract class ProducerTransformer extends Transformer {
    constructor(sourceTypeRef: TypeRef, readonly consumer: Transformer | undefined) {
        super(sourceTypeRef);
    }

    getChildren(): OrderedSet<Type> {
        const children = super.getChildren();
        if (this.consumer === undefined) return children;
        return children.union(this.consumer.getChildren());
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ProducerTransformer)) return false;
        return is(this.consumer, other.consumer);
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, hash(this.consumer));
    }
}

export abstract class MatchTransformer extends Transformer {
    constructor(sourceTypeRef: TypeRef, readonly transformer: Transformer) {
        super(sourceTypeRef);
    }

    getChildren(): OrderedSet<Type> {
        return super.getChildren().union(this.transformer.getChildren());
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
}

export class DecodingTransformer extends ProducerTransformer {
    constructor(sourceTypeRef: TypeRef, consumer: Transformer | undefined) {
        super(sourceTypeRef, consumer);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer !== undefined) {
            return panic("Reversing a decoding transformer cannot have a continuation");
        }

        if (this.consumer === undefined) {
            return new EncodingTransformer(targetTypeRef);
        } else {
            return this.consumer.reverse(targetTypeRef, new EncodingTransformer(this.consumer.sourceTypeRef));
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new DecodingTransformer(
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
    reverse(_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer {
        return panic("Can't reverse encoding transformer");
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new EncodingTransformer(builder.reconstituteTypeRef(this.sourceTypeRef));
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof EncodingTransformer)) return false;
        return true;
    }
}

export class ChoiceTransformer extends Transformer {
    constructor(sourceTypeRef: TypeRef, public readonly transformers: List<Transformer>) {
        super(sourceTypeRef);
    }

    getChildren(): OrderedSet<Type> {
        let children = super.getChildren();
        this.transformers.forEach(xfer => {
            children = children.union(xfer.getChildren());
        });
        return children;
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        const transformers = this.transformers.map(xfer => xfer.reverse(targetTypeRef, continuationTransformer));
        return new ChoiceTransformer(targetTypeRef, transformers);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new ChoiceTransformer(
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformers.map(xfer => xfer.reconstitute(builder))
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ChoiceTransformer)) return false;
        return this.transformers.equals(other.transformers);
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, this.transformers.hashCode());
    }
}

export class DecodingChoiceTransformer extends Transformer {
    constructor(
        sourceTypeRef: TypeRef,
        readonly nullTransformer: Transformer | undefined,
        readonly integerTransformer: Transformer | undefined,
        readonly doubleTransformer: Transformer | undefined,
        readonly boolTransformer: Transformer | undefined,
        readonly stringTransformer: Transformer | undefined,
        readonly arrayTransformer: Transformer | undefined,
        readonly objectTransformer: Transformer | undefined
    ) {
        super(sourceTypeRef);
    }

    getChildren(): OrderedSet<Type> {
        let children = super.getChildren();
        if (this.nullTransformer !== undefined) {
            children = children.union(this.nullTransformer.getChildren());
        }
        if (this.integerTransformer !== undefined) {
            children = children.union(this.integerTransformer.getChildren());
        }
        if (this.doubleTransformer !== undefined) {
            children = children.union(this.doubleTransformer.getChildren());
        }
        if (this.boolTransformer !== undefined) {
            children = children.union(this.boolTransformer.getChildren());
        }
        if (this.stringTransformer !== undefined) {
            children = children.union(this.stringTransformer.getChildren());
        }
        if (this.arrayTransformer !== undefined) {
            children = children.union(this.arrayTransformer.getChildren());
        }
        if (this.objectTransformer !== undefined) {
            children = children.union(this.objectTransformer.getChildren());
        }
        return children;
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        assert(
            continuationTransformer === undefined,
            "Reversing a decoding transformer can't have a target transformer"
        );

        let transformers: List<Transformer> = List();

        function addCase(transformer: Transformer | undefined) {
            if (transformer === undefined) return;
            transformers = transformers.push(
                transformer.reverse(targetTypeRef, new EncodingTransformer(transformer.sourceTypeRef))
            );
        }

        addCase(this.nullTransformer);
        addCase(this.integerTransformer);
        addCase(this.doubleTransformer);
        addCase(this.boolTransformer);
        addCase(this.stringTransformer);
        addCase(this.arrayTransformer);
        addCase(this.objectTransformer);

        return new ChoiceTransformer(targetTypeRef, transformers);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        function reconstitute(xf: Transformer | undefined) {
            if (xf === undefined) return undefined;
            return xf.reconstitute(builder);
        }

        return new DecodingChoiceTransformer(
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
        if (!is(this.nullTransformer, other.nullTransformer)) return false;
        if (!is(this.integerTransformer, other.integerTransformer)) return false;
        if (!is(this.doubleTransformer, other.doubleTransformer)) return false;
        if (!is(this.boolTransformer, other.boolTransformer)) return false;
        if (!is(this.stringTransformer, other.stringTransformer)) return false;
        if (!is(this.arrayTransformer, other.arrayTransformer)) return false;
        if (!is(this.objectTransformer, other.objectTransformer)) return false;
        return true;
    }

    hashCode(): number {
        let h = super.hashCode();
        h = addHashCode(h, hash(this.nullTransformer));
        h = addHashCode(h, hash(this.integerTransformer));
        h = addHashCode(h, hash(this.doubleTransformer));
        h = addHashCode(h, hash(this.boolTransformer));
        h = addHashCode(h, hash(this.stringTransformer));
        h = addHashCode(h, hash(this.arrayTransformer));
        h = addHashCode(h, hash(this.objectTransformer));
        return h;
    }
}

export class UnionMemberMatchTransformer extends MatchTransformer {
    constructor(sourceTypeRef: TypeRef, transformer: Transformer, private readonly _memberTypeRef: TypeRef) {
        super(sourceTypeRef, transformer);
    }

    get sourceType(): UnionType {
        const t = this.sourceTypeRef.deref()[0];
        if (!(t instanceof UnionType)) {
            return panic("The source of a union member match transformer must be a union type");
        }
        return t;
    }

    get memberType(): Type {
        return this._memberTypeRef.deref()[0];
    }

    getChildren(): OrderedSet<Type> {
        return super.getChildren().add(this.memberType);
    }

    reverse(_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer {
        return panic("Can't reverse union member match transformer");
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new UnionMemberMatchTransformer(
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformer.reconstitute(builder),
            builder.reconstituteTypeRef(this._memberTypeRef)
        );
    }

    equals(other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof UnionMemberMatchTransformer)) return false;
        return this._memberTypeRef.equals(other._memberTypeRef);
    }

    hashCode(): number {
        const h = super.hashCode();
        return addHashCode(h, this._memberTypeRef.hashCode());
    }
}

/**
 * This matches strings and enum cases.
 */
export class StringMatchTransformer extends MatchTransformer {
    constructor(sourceTypeRef: TypeRef, transformer: Transformer, readonly stringCase: string) {
        super(sourceTypeRef, transformer);
    }

    get sourceType(): EnumType | PrimitiveType {
        const t = this.sourceTypeRef.deref()[0];
        if (!(t instanceof EnumType) && !(t instanceof PrimitiveType && t.kind === "string")) {
            return panic("The source of a string match transformer must be an enum or string type");
        }
        return t;
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        return this.transformer.reverse(
            targetTypeRef,
            new StringProducerTransformer(this.transformer.sourceTypeRef, continuationTransformer, this.stringCase)
        );
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringMatchTransformer(
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
        return addHashCode(h, hash(this.stringCase));
    }
}

export class UnionInstantiationTransformer extends Transformer {
    constructor(sourceTypeRef: TypeRef) {
        super(sourceTypeRef);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer === undefined) {
            return panic("Union instantiation transformer reverse must have a continuation");
        }

        return new UnionMemberMatchTransformer(targetTypeRef, continuationTransformer, this.sourceTypeRef);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new UnionInstantiationTransformer(builder.reconstituteTypeRef(this.sourceTypeRef));
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
    constructor(sourceTypeRef: TypeRef, consumer: Transformer | undefined, readonly result: string) {
        super(sourceTypeRef, consumer);
    }

    reverse(targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer === undefined) {
            return panic("Reversing a string producer transformer must have a continuation");
        }

        if (this.consumer === undefined) {
            return new StringMatchTransformer(targetTypeRef, continuationTransformer, this.result);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new StringMatchTransformer(this.consumer.sourceTypeRef, continuationTransformer, this.result)
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringProducerTransformer(
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
        return addHashCode(h, hash(this.consumer));
    }
}

export class Transformation {
    constructor(private readonly _targetTypeRef: TypeRef, readonly transformer: Transformer) {}

    get sourceType(): Type {
        return this.transformer.sourceType;
    }

    get targetType(): Type {
        return this._targetTypeRef.deref()[0];
    }

    get reverseTransformer(): Transformer {
        return this.transformer.reverse(this._targetTypeRef, undefined);
    }

    getChildren(): OrderedSet<Type> {
        return this.transformer.getChildren().add(this.targetType);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformation {
        return new Transformation(
            builder.reconstituteTypeRef(this._targetTypeRef),
            this.transformer.reconstitute(builder)
        );
    }

    equals(other: any): boolean {
        if (!(other instanceof Transformation)) return false;
        return this._targetTypeRef.equals(other._targetTypeRef) && this.transformer.equals(other.transformer);
    }

    hashCode(): number {
        let h = this._targetTypeRef.hashCode();
        h = addHashCode(h, this.transformer.hashCode());
        return h;
    }
}

class TransformationTypeAttributeKind extends TypeAttributeKind<Transformation> {
    constructor() {
        super("transformation");
    }

    get inIdentity(): boolean {
        return true;
    }

    children(xf: Transformation): OrderedSet<Type> {
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

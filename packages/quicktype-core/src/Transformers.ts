import {
    setUnionInto,
    areEqual,
    hashCodeOf,
    definedMap,
    addHashCode,
    definedMapWithDefault,
    arraySortByInto,
    hashString,
} from "collection-utils";

import { type Type, type TypeKind } from "./Type";
import { UnionType, EnumType, PrimitiveType } from "./Type";
import { TypeAttributeKind } from "./attributes/TypeAttributes";
import { panic, assert, indentationString } from "./support/Support";
import { type BaseGraphRewriteBuilder } from "./GraphRewriting";
import { type TypeRef, type TypeGraph } from "./TypeGraph";
import { derefTypeRef } from "./TypeGraph";

function debugStringForType (t: Type): string {
    const target = followTargetType(t);
    if (t === target) {
        return t.kind;
    }

    return `${t.kind} (${target.kind})`;
}

function getNumberOfNodes (xfer: Transformer | undefined): number {
    return definedMapWithDefault(xfer, 0, x => x.getNumberOfNodes());
}

export abstract class Transformer {
    constructor (readonly kind: string, protected readonly graph: TypeGraph, readonly sourceTypeRef: TypeRef) {}

    get sourceType (): Type {
        return derefTypeRef(this.sourceTypeRef, this.graph);
    }

    /** This must return a newly constructed set. */
    getChildren (): Set<Type> {
        return new Set([this.sourceType]);
    }

    getNumberOfNodes (): number {
        return 1;
    }

    abstract get canFail (): boolean;

    abstract reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer;

    abstract reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer;

    equals (other: any): boolean {
        if (!(other instanceof Transformer)) return false;
        return this.sourceTypeRef === other.sourceTypeRef;
    }

    hashCode (): number {
        return hashCodeOf(this.sourceTypeRef);
    }

    protected debugDescription (): string {
        return `${debugStringForType(this.sourceType)} -> ${this.kind}`;
    }

    protected debugPrintContinuations (_indent: number): void {
        return;
    }

    debugPrint (indent: number): void {
        console.log(indentationString(indent) + this.debugDescription());
        this.debugPrintContinuations(indent + 1);
    }
}

export abstract class ProducerTransformer extends Transformer {
    constructor (kind: string, graph: TypeGraph, sourceTypeRef: TypeRef, readonly consumer: Transformer | undefined) {
        super(kind, graph, sourceTypeRef);
    }

    getChildren (): Set<Type> {
        const children = super.getChildren();
        if (this.consumer === undefined) return children;
        return setUnionInto(children, this.consumer.getChildren());
    }

    getNumberOfNodes (): number {
        return super.getNumberOfNodes() + getNumberOfNodes(this.consumer);
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ProducerTransformer)) return false;
        return areEqual(this.consumer, other.consumer);
    }

    hashCode (): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this.consumer));
    }

    protected debugPrintContinuations (indent: number): void {
        if (this.consumer === undefined) return;
        this.consumer.debugPrint(indent);
    }
}

export abstract class MatchTransformer extends Transformer {
    constructor (kind: string, graph: TypeGraph, sourceTypeRef: TypeRef, readonly transformer: Transformer) {
        super(kind, graph, sourceTypeRef);
    }

    getChildren (): Set<Type> {
        return setUnionInto(super.getChildren(), this.transformer.getChildren());
    }

    getNumberOfNodes (): number {
        return super.getNumberOfNodes() + this.transformer.getNumberOfNodes();
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof MatchTransformer)) return false;
        return this.transformer.equals(other.transformer);
    }

    hashCode (): number {
        const h = super.hashCode();
        return addHashCode(h, this.transformer.hashCode());
    }

    protected debugPrintContinuations (indent: number): void {
        this.transformer.debugPrint(indent);
    }
}

export class DecodingTransformer extends ProducerTransformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined) {
        super("decode", graph, sourceTypeRef, consumer);
    }

    get canFail (): boolean {
        return false;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer !== undefined) {
            return panic("Reversing a decoding transformer cannot have a continuation");
        }

        if (this.consumer === undefined) {
            return new EncodingTransformer(this.graph, targetTypeRef);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new EncodingTransformer(this.graph, this.consumer.sourceTypeRef),
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new DecodingTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            definedMap(this.consumer, xfer => xfer.reconstitute(builder)),
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof DecodingTransformer;
    }
}

export class EncodingTransformer extends Transformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef) {
        super("encode", graph, sourceTypeRef);
    }

    get canFail (): boolean {
        return false;
    }

    reverse (_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer {
        return panic("Can't reverse encoding transformer");
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new EncodingTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef));
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof EncodingTransformer)) return false;
        return true;
    }
}

export class ArrayDecodingTransformer extends ProducerTransformer {
    constructor (
        graph: TypeGraph,
        sourceTypeRef: TypeRef,
        consumer: Transformer | undefined,
        private readonly _itemTargetTypeRef: TypeRef,
        readonly itemTransformer: Transformer,
    ) {
        super("decode-array", graph, sourceTypeRef, consumer);
    }

    getChildren (): Set<Type> {
        const children = super.getChildren();
        children.add(this.itemTargetType);
        return setUnionInto(children, this.itemTransformer.getChildren());
    }

    getNumberOfNodes (): number {
        return super.getNumberOfNodes() + this.itemTransformer.getNumberOfNodes();
    }

    get canFail (): boolean {
        return false;
    }

    get itemTargetType (): Type {
        return derefTypeRef(this._itemTargetTypeRef, this.graph);
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer !== undefined) {
            return panic("Reversing a decoding transformer cannot have a continuation");
        }

        const itemTransformer = this.itemTransformer.reverse(this._itemTargetTypeRef, undefined);

        if (this.consumer === undefined) {
            return new ArrayEncodingTransformer(
                this.graph,
                targetTypeRef,
                this.itemTransformer.sourceTypeRef,
                itemTransformer,
            );
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new ArrayEncodingTransformer(
                    this.graph,
                    this.consumer.sourceTypeRef,
                    this.itemTransformer.sourceTypeRef,
                    itemTransformer,
                ),
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new ArrayDecodingTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            definedMap(this.consumer, xfer => xfer.reconstitute(builder)),
            builder.reconstituteTypeRef(this._itemTargetTypeRef),
            this.itemTransformer.reconstitute(builder),
        );
    }

    hashCode (): number {
        let h = super.hashCode();
        h = addHashCode(h, hashCodeOf(this._itemTargetTypeRef));
        h = addHashCode(h, this.itemTransformer.hashCode());
        return h;
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ArrayDecodingTransformer)) return false;
        if (!areEqual(this._itemTargetTypeRef, other._itemTargetTypeRef)) return false;
        return this.itemTransformer.equals(other.itemTransformer);
    }

    protected debugPrintContinuations (indent: number): void {
        this.itemTransformer.debugPrint(indent);
        super.debugPrintContinuations(indent);
    }
}

export class ArrayEncodingTransformer extends Transformer {
    constructor (
        graph: TypeGraph,
        sourceTypeRef: TypeRef,
        private readonly _itemTargetTypeRef: TypeRef,
        readonly itemTransformer: Transformer,
    ) {
        super("encode-array", graph, sourceTypeRef);
    }

    getChildren (): Set<Type> {
        const children = super.getChildren();
        children.add(this.itemTargetType);
        return setUnionInto(children, this.itemTransformer.getChildren());
    }

    getNumberOfNodes (): number {
        return super.getNumberOfNodes() + this.itemTransformer.getNumberOfNodes();
    }

    get canFail (): boolean {
        return false;
    }

    get itemTargetType (): Type {
        return derefTypeRef(this._itemTargetTypeRef, this.graph);
    }

    reverse (_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer {
        return panic("Can't reverse array encoding transformer");
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new ArrayEncodingTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            builder.reconstituteTypeRef(this._itemTargetTypeRef),
            this.itemTransformer.reconstitute(builder),
        );
    }

    hashCode (): number {
        let h = super.hashCode();
        h = addHashCode(h, hashCodeOf(this._itemTargetTypeRef));
        return addHashCode(h, this.itemTransformer.hashCode());
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ArrayEncodingTransformer)) return false;
        if (!areEqual(this._itemTargetTypeRef, other._itemTargetTypeRef)) return false;
        return this.itemTransformer.equals(other.itemTransformer);
    }

    protected debugPrintContinuations (indent: number): void {
        this.itemTransformer.debugPrint(indent);
        super.debugPrintContinuations(indent);
    }
}

export class ChoiceTransformer extends Transformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef, public readonly transformers: readonly Transformer[]) {
        super("choice", graph, sourceTypeRef);
        assert(transformers.length > 0, "Choice must have at least one transformer");
    }

    getChildren (): Set<Type> {
        let children = super.getChildren();
        for (const xfer of this.transformers) {
            setUnionInto(children, xfer.getChildren());
        }

        return children;
    }

    getNumberOfNodes (): number {
        let n = 0;
        for (const xfer of this.transformers) {
            n += xfer.getNumberOfNodes();
        }

        return super.getNumberOfNodes() + n;
    }

    get canFail (): boolean {
        return this.transformers.some(xfer => xfer.canFail);
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        const transformers = this.transformers.map(xfer => xfer.reverse(targetTypeRef, continuationTransformer));
        if (transformers.every(xfer => xfer instanceof UnionMemberMatchTransformer)) {
            const memberMatchers = transformers as UnionMemberMatchTransformer[];
            const first = memberMatchers[0];
            if (memberMatchers.every(xfer => first.memberType.equals(xfer.memberType))) {
                const subTransformers = memberMatchers.map(xfer => xfer.transformer);
                return new UnionMemberMatchTransformer(
                    this.graph,
                    targetTypeRef,
                    new ChoiceTransformer(this.graph, subTransformers[0].sourceTypeRef, subTransformers),
                    first.memberTypeRef,
                );
            }
        }

        return new ChoiceTransformer(this.graph, targetTypeRef, transformers);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new ChoiceTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformers.map(xfer => xfer.reconstitute(builder)),
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof ChoiceTransformer)) return false;
        return areEqual(this.transformers, other.transformers);
    }

    hashCode (): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this.transformers));
    }

    protected debugPrintContinuations (indent: number): void {
        for (const xfer of this.transformers) {
            xfer.debugPrint(indent);
        }
    }
}

export class DecodingChoiceTransformer extends Transformer {
    constructor (
        graph: TypeGraph,
        sourceTypeRef: TypeRef,
        readonly nullTransformer: Transformer | undefined,
        readonly integerTransformer: Transformer | undefined,
        readonly doubleTransformer: Transformer | undefined,
        readonly boolTransformer: Transformer | undefined,
        readonly stringTransformer: Transformer | undefined,
        readonly arrayTransformer: Transformer | undefined,
        readonly objectTransformer: Transformer | undefined,
    ) {
        super("decoding-choice", graph, sourceTypeRef);
    }

    get transformers (): readonly Transformer[] {
        const transformers: Transformer[] = [];
        function add (xfer: Transformer | undefined) {
            if (xfer === undefined) return;
            transformers.push(xfer);
        }

        add(this.nullTransformer);
        add(this.integerTransformer);
        add(this.doubleTransformer);
        add(this.boolTransformer);
        add(this.stringTransformer);
        add(this.arrayTransformer);
        add(this.objectTransformer);

        return transformers;
    }

    getChildren (): Set<Type> {
        let children = super.getChildren();
        for (const xfer of this.transformers) {
            setUnionInto(children, xfer.getChildren());
        }

        return children;
    }

    getNumberOfNodes (): number {
        let n = super.getNumberOfNodes();
        for (const xfer of this.transformers) {
            n += getNumberOfNodes(xfer);
        }

        return n;
    }

    get canFail (): boolean {
        return false;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        assert(
            continuationTransformer === undefined,
            "Reversing a decoding transformer can't have a target transformer",
        );

        let transformers = new Map<TypeKind, Transformer[]>();
        let memberMatchTransformers = new Map<Type, Transformer[]>();

        function addCase (reversed: Transformer) {
            if (reversed instanceof UnionMemberMatchTransformer) {
                const memberType = reversed.memberType;
                let arr = memberMatchTransformers.get(memberType);
                if (arr === undefined) {
                    arr = [];
                    memberMatchTransformers.set(memberType, arr);
                }

                arr.push(reversed);
            } else {
                const kind = reversed.sourceType.kind;
                let arr = transformers.get(kind);
                if (arr === undefined) {
                    arr = [];
                    transformers.set(kind, arr);
                }

                arr.push(reversed);
            }
        }

        function reverseAndAdd (transformer: Transformer) {
            const reversed = transformer.reverse(targetTypeRef, undefined);
            let cases: readonly Transformer[] = [];
            // Flatten nested ChoiceTransformers
            if (reversed instanceof ChoiceTransformer) {
                cases = reversed.transformers;
            } else {
                cases = [reversed];
            }

            for (const xfer of cases) {
                addCase(xfer);
            }
        }

        // FIXME: Actually, keep all the failing transformers and put them first, then
        // finally do the simplest non-failing one.  Actually actually, maybe not, since
        // we're reversing to encode?  What's a case where this would be useful?

        // If there are non-failing transformers, we ignore the ones that can fail and
        // just pick the "simplest" non-failing one, being the one with the least number
        // of nodes.
        function filter (xfers: Transformer[]): Transformer[] {
            assert(xfers.length > 0, "Must have at least one transformer");

            const nonfailing = xfers.filter(xfer => {
                // For member match transformers we're deciding between
                // multiple that match against the same member, so the fact
                // that the match can fail is not important, since if it fails
                // it will fail for all candidates.  The question is whether
                // its continuation can fail.
                if (xfer instanceof UnionMemberMatchTransformer) {
                    return !xfer.transformer.canFail;
                } else {
                    return !xfer.canFail;
                }
            });
            if (nonfailing.length === 0) return xfers;

            const smallest = arraySortByInto(
                nonfailing.map(x => [x.getNumberOfNodes(), x] as [number, Transformer]),
                ([c, _]) => c,
            )[0][1];
            return [smallest];
        }

        this.transformers.forEach(reverseAndAdd);

        const allTransformers = Array.from(transformers.values()).concat(Array.from(memberMatchTransformers.values()));
        const resultingTransformers = ([] as Transformer[]).concat(...allTransformers.map(filter));

        // No choice needed if there's only one
        if (resultingTransformers.length === 1) {
            return resultingTransformers[0];
        }

        return new ChoiceTransformer(this.graph, targetTypeRef, resultingTransformers);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        function reconstitute (xf: Transformer | undefined) {
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
            reconstitute(this.objectTransformer),
        );
    }

    equals (other: any): boolean {
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

    hashCode (): number {
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

    protected debugPrintContinuations (indent: number): void {
        for (const xfer of this.transformers) {
            xfer.debugPrint(indent);
        }
    }
}

export class UnionMemberMatchTransformer extends MatchTransformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef, transformer: Transformer, readonly memberTypeRef: TypeRef) {
        super("union-member-match", graph, sourceTypeRef, transformer);
    }

    get sourceType (): UnionType {
        const t = derefTypeRef(this.sourceTypeRef, this.graph);
        if (!(t instanceof UnionType)) {
            return panic("The source of a union member match transformer must be a union type");
        }

        return t;
    }

    get canFail (): boolean {
        return true;
    }

    get memberType (): Type {
        return derefTypeRef(this.memberTypeRef, this.graph);
    }

    getChildren (): Set<Type> {
        return super.getChildren().add(this.memberType);
    }

    reverse (_targetTypeRef: TypeRef, _continuationTransformer: Transformer | undefined): Transformer {
        return panic("Can't reverse union member match transformer");
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new UnionMemberMatchTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformer.reconstitute(builder),
            builder.reconstituteTypeRef(this.memberTypeRef),
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof UnionMemberMatchTransformer)) return false;
        return this.memberTypeRef === other.memberTypeRef;
    }

    hashCode (): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this.memberTypeRef));
    }

    protected debugDescription (): string {
        return `${super.debugDescription()} - member: ${debugStringForType(this.memberType)}`;
    }
}

/**
 * This matches strings and enum cases.
 */
export class StringMatchTransformer extends MatchTransformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef, transformer: Transformer, readonly stringCase: string) {
        super("string-match", graph, sourceTypeRef, transformer);
    }

    get sourceType (): EnumType | PrimitiveType {
        const t = derefTypeRef(this.sourceTypeRef, this.graph);
        if (!(t instanceof EnumType) && !(t instanceof PrimitiveType && t.kind === "string")) {
            return panic("The source of a string match transformer must be an enum or string type");
        }

        return t;
    }

    get canFail (): boolean {
        return true;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        return this.transformer.reverse(
            targetTypeRef,
            new StringProducerTransformer(
                this.graph,
                this.transformer.sourceTypeRef,
                continuationTransformer,
                this.stringCase,
            ),
        );
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringMatchTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            this.transformer.reconstitute(builder),
            this.stringCase,
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof StringMatchTransformer)) return false;
        return this.stringCase !== other.stringCase;
    }

    hashCode (): number {
        const h = super.hashCode();
        return addHashCode(h, hashString(this.stringCase));
    }

    protected debugDescription (): string {
        return `${super.debugDescription()} - case: ${this.stringCase}`;
    }
}

export class UnionInstantiationTransformer extends Transformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef) {
        super("union-instantiation", graph, sourceTypeRef);
    }

    get canFail (): boolean {
        return false;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (continuationTransformer === undefined) {
            return panic("Union instantiation transformer reverse must have a continuation");
        }

        return new UnionMemberMatchTransformer(this.graph, targetTypeRef, continuationTransformer, this.sourceTypeRef);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new UnionInstantiationTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef));
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof UnionInstantiationTransformer;
    }
}

/**
 * Produces a string or an enum case.
 */
export class StringProducerTransformer extends ProducerTransformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined, readonly result: string) {
        super("string-producer", graph, sourceTypeRef, consumer);
    }

    get canFail (): boolean {
        return false;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
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
                    this.result,
                ),
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringProducerTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            definedMap(this.consumer, xfer => xfer.reconstitute(builder)),
            this.result,
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        if (!(other instanceof StringProducerTransformer)) return false;
        return this.result === other.result;
    }

    hashCode (): number {
        const h = super.hashCode();
        return addHashCode(h, hashCodeOf(this.consumer));
    }

    protected debugDescription (): string {
        return `${super.debugDescription()} - result: ${this.result}`;
    }
}

export class ParseStringTransformer extends ProducerTransformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined) {
        super("parse-string", graph, sourceTypeRef, consumer);
    }

    get canFail (): boolean {
        return true;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (this.consumer === undefined) {
            return new StringifyTransformer(this.graph, targetTypeRef, continuationTransformer);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new StringifyTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer),
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new ParseStringTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            definedMap(this.consumer, xfer => xfer.reconstitute(builder)),
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof ParseStringTransformer;
    }
}

export class StringifyTransformer extends ProducerTransformer {
    constructor (graph: TypeGraph, sourceTypeRef: TypeRef, consumer: Transformer | undefined) {
        super("stringify", graph, sourceTypeRef, consumer);
    }

    get canFail (): boolean {
        return false;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (this.consumer === undefined) {
            return new ParseStringTransformer(this.graph, targetTypeRef, continuationTransformer);
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new ParseStringTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer),
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new StringifyTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            definedMap(this.consumer, xfer => xfer.reconstitute(builder)),
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        return other instanceof StringifyTransformer;
    }
}

export class MinMaxLengthCheckTransformer extends ProducerTransformer {
    constructor (
        graph: TypeGraph,
        sourceTypeRef: TypeRef,
        consumer: Transformer | undefined,
        readonly minLength: number | undefined,
        readonly maxLength: number | undefined,
    ) {
        super("min-max-length-check", graph, sourceTypeRef, consumer);
    }

    get canFail (): boolean {
        return true;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (this.consumer === undefined) {
            return new MinMaxLengthCheckTransformer(
                this.graph,
                targetTypeRef,
                continuationTransformer,
                this.minLength,
                this.maxLength,
            );
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new MinMaxLengthCheckTransformer(
                    this.graph,
                    this.consumer.sourceTypeRef,
                    continuationTransformer,
                    this.minLength,
                    this.maxLength,
                ),
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new MinMaxLengthCheckTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            definedMap(this.consumer, xfer => xfer.reconstitute(builder)),
            this.minLength,
            this.maxLength,
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        return (
            other instanceof MinMaxLengthCheckTransformer &&
            this.minLength === other.minLength &&
            this.maxLength === other.maxLength
        );
    }
}

export class MinMaxValueTransformer extends ProducerTransformer {
    constructor (
        graph: TypeGraph,
        sourceTypeRef: TypeRef,
        consumer: Transformer | undefined,
        readonly minimum: number | undefined,
        readonly maximum: number | undefined,
    ) {
        super("min-max-value-check", graph, sourceTypeRef, consumer);
    }

    get canFail (): boolean {
        return true;
    }

    reverse (targetTypeRef: TypeRef, continuationTransformer: Transformer | undefined): Transformer {
        if (this.consumer === undefined) {
            return new MinMaxValueTransformer(
                this.graph,
                targetTypeRef,
                continuationTransformer,
                this.minimum,
                this.maximum,
            );
        } else {
            return this.consumer.reverse(
                targetTypeRef,
                new MinMaxValueTransformer(
                    this.graph,
                    this.consumer.sourceTypeRef,
                    continuationTransformer,
                    this.minimum,
                    this.maximum,
                ),
            );
        }
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformer {
        return new MinMaxValueTransformer(
            builder.typeGraph,
            builder.reconstituteTypeRef(this.sourceTypeRef),
            definedMap(this.consumer, xfer => xfer.reconstitute(builder)),
            this.minimum,
            this.maximum,
        );
    }

    equals (other: any): boolean {
        if (!super.equals(other)) return false;
        return (
            other instanceof MinMaxValueTransformer && this.minimum === other.minimum && this.maximum === other.maximum
        );
    }
}

export class Transformation {
    constructor (
        private readonly _graph: TypeGraph,
        private readonly _targetTypeRef: TypeRef,
        readonly transformer: Transformer,
    ) {}

    get sourceType (): Type {
        return this.transformer.sourceType;
    }

    get targetType (): Type {
        return derefTypeRef(this._targetTypeRef, this._graph);
    }

    get reverse (): Transformation {
        return new Transformation(
            this._graph,
            this.transformer.sourceTypeRef,
            this.transformer.reverse(this._targetTypeRef, undefined),
        );
    }

    getChildren (): Set<Type> {
        return this.transformer.getChildren().add(this.targetType);
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder): Transformation {
        return new Transformation(
            builder.typeGraph,
            builder.reconstituteTypeRef(this._targetTypeRef),
            this.transformer.reconstitute(builder),
        );
    }

    equals (other: any): boolean {
        if (!(other instanceof Transformation)) return false;
        return this._targetTypeRef === other._targetTypeRef && this.transformer.equals(other.transformer);
    }

    hashCode (): number {
        let h = hashCodeOf(this._targetTypeRef);
        h = addHashCode(h, this.transformer.hashCode());
        return h;
    }

    debugPrint (): void {
        this.transformer.debugPrint(0);
        console.log(`-> ${debugStringForType(this.targetType)}`);
    }
}

class TransformationTypeAttributeKind extends TypeAttributeKind<Transformation> {
    constructor () {
        super("transformation");
    }

    appliesToTypeKind (_kind: TypeKind): boolean {
        return true;
    }

    get inIdentity (): boolean {
        return true;
    }

    children (xf: Transformation): Set<Type> {
        return xf.getChildren();
    }

    reconstitute<TBuilder extends BaseGraphRewriteBuilder>(builder: TBuilder, xf: Transformation): Transformation {
        return xf.reconstitute(builder);
    }

    stringify (_: Transformation): string {
        return "transformation";
    }
}

export const transformationTypeAttributeKind: TypeAttributeKind<Transformation> = new TransformationTypeAttributeKind();

export function transformationForType (t: Type): Transformation | undefined {
    return transformationTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}

export function followTargetType (t: Type): Type {
    for (;;) {
        const xf = transformationForType(t);
        if (xf === undefined) return t;
        t = xf.targetType;
    }
}

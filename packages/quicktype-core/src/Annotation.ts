export class AnnotationData {}

export class IssueAnnotationData extends AnnotationData {
    constructor(readonly message: string) {
        super();
    }
}

export const anyTypeIssueAnnotation = new IssueAnnotationData(
    "quicktype cannot infer this type because there is no data about it in the input."
);
export const nullTypeIssueAnnotation = new IssueAnnotationData(
    "The only value for this in the input is null, which means you probably need a more complete input sample."
);

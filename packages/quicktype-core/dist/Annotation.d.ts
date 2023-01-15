export declare class AnnotationData {
}
export declare class IssueAnnotationData extends AnnotationData {
    readonly message: string;
    constructor(message: string);
}
export declare const anyTypeIssueAnnotation: IssueAnnotationData;
export declare const nullTypeIssueAnnotation: IssueAnnotationData;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class AnnotationData {
}
exports.AnnotationData = AnnotationData;
class IssueAnnotationData extends AnnotationData {
    constructor(message) {
        super();
        this.message = message;
    }
}
exports.IssueAnnotationData = IssueAnnotationData;
exports.anyTypeIssueAnnotation = new IssueAnnotationData("quicktype cannot infer this type because there is no data about it in the input.");
exports.nullTypeIssueAnnotation = new IssueAnnotationData("The only value for this in the input is null, which means you probably need a more complete input sample.");

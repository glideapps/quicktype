type DescriptionBlockCommentConfig = { descriptionBlock: string[] };
type InlineCommentConfig = { lines: string[] };
type CustomCommentConfig = {
    customLines: string[];
    lineStart?: string;
    lineEnd?: string;
    beforeLine?: string;
    afterLine?: string;
    firstLineStart?: string;
};

export type CommentConfig = DescriptionBlockCommentConfig | InlineCommentConfig | CustomCommentConfig;

export type Comment = string | CommentConfig;

export const isStringComment = (comment: Comment): comment is string => {
    return typeof comment === "string";
};
